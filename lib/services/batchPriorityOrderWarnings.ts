import { prisma } from '@/lib/prisma'
import type { PhraseType } from '@/lib/constants/phraseTypes'
import type { BatchPRItem } from './batchConflictService'
import type { BatchSubmitWarning } from './batchSubmitWarnings'

interface ChainEntry {
  word: string
  code: string
  type: PhraseType
  weight: number
  source: 'existing' | 'batch'
  itemId?: string
  oldWord?: string
  action?: BatchPRItem['action']
}

const PRIORITY_TYPES = new Set<PhraseType>(['Single', 'Phrase', 'Supplement', 'CSS', 'CSSSingle'])

function normalizeType(item: BatchPRItem): PhraseType {
  return (item.type || 'Phrase') as PhraseType
}

function normalizeCode(code: string): string {
  return code.trim().toLowerCase()
}

function chainKey(type: PhraseType, code: string): string {
  return `${type}:${normalizeCode(code)}`
}

function sortChain(entries: ChainEntry[]): ChainEntry[] {
  return [...entries].sort((left, right) => {
    if (left.weight !== right.weight) return left.weight - right.weight
    return left.word.localeCompare(right.word)
  })
}

function nextWeight(entries: ChainEntry[], type: PhraseType): number {
  if (entries.length === 0) return type === 'Single' || type === 'CSSSingle' ? 10 : 100
  return Math.max(...entries.map(entry => entry.weight)) + 1
}

function removeEntry(entries: ChainEntry[], word: string, code: string, type: PhraseType): ChainEntry[] {
  const normalizedCode = normalizeCode(code)
  return entries.filter(entry =>
    !(entry.word === word && normalizeCode(entry.code) === normalizedCode && entry.type === type)
  )
}

function applyBatchItems(initial: Map<string, ChainEntry[]>, items: BatchPRItem[]): Map<string, ChainEntry[]> {
  const chains = new Map<string, ChainEntry[]>()
  for (const [key, entries] of initial) chains.set(key, [...entries])

  for (const item of items) {
    const type = normalizeType(item)
    if (!PRIORITY_TYPES.has(type)) continue
    const code = normalizeCode(item.code)
    if (!code) continue
    const key = chainKey(type, code)
    const current = chains.get(key) || []

    if (item.action === 'Delete') {
      chains.set(key, removeEntry(current, item.word, code, type))
      continue
    }

    if (item.action === 'Change' && item.oldWord) {
      const index = current.findIndex(entry => entry.word === item.oldWord)
      if (index >= 0) {
        const updated = [...current]
        updated[index] = {
          ...updated[index],
          word: item.word,
          source: 'batch',
          itemId: item.id,
          oldWord: item.oldWord,
          action: item.action,
        }
        chains.set(key, updated)
      } else {
        chains.set(key, [
          ...current,
          {
            word: item.word,
            code,
            type,
            weight: item.weight ?? nextWeight(current, type),
            source: 'batch',
            itemId: item.id,
            oldWord: item.oldWord,
            action: item.action,
          },
        ])
      }
      continue
    }

    const exists = current.some(entry => entry.word === item.word && normalizeCode(entry.code) === code && entry.type === type)
    if (exists) continue
    chains.set(key, [
      ...current,
      {
        word: item.word,
        code,
        type,
        weight: item.weight ?? nextWeight(current, type),
        source: 'batch',
        itemId: item.id,
        action: item.action,
      },
    ])
  }

  return chains
}

function warningForEntry(entry: ChainEntry, chain: ChainEntry[], item: BatchPRItem): BatchSubmitWarning | null {
  const index = chain.findIndex(candidate => candidate.itemId === entry.itemId && candidate.word === entry.word)
  if (index < 0) return null

  const behind = chain[index + 1]
  const replacing = entry.oldWord && entry.oldWord !== entry.word
  if (!behind && !replacing) return null

  const parts: string[] = []
  if (replacing) {
    parts.push(`你正在用「${entry.word}」替换同码位原词「${entry.oldWord}」`)
  }
  if (behind) {
    parts.push(`提交后「${entry.word}」会排在「${behind.word}」前`)
  }
  parts.push('请确认这符合日常使用优先级；如果只是试探性调整，建议先保留原顺序或交给管理员细看')

  return {
    id: item.id,
    word: entry.word,
    code: entry.code,
    weight: entry.weight,
    warningType: 'code_chain_priority',
    comparedWord: behind?.word,
    previousWord: entry.oldWord,
    impact: parts.join('；'),
  }
}

export async function buildPriorityOrderWarnings(items: BatchPRItem[]): Promise<BatchSubmitWarning[]> {
  const relevantItems = items.filter(item => {
    const type = normalizeType(item)
    return item.action !== 'Delete' && PRIORITY_TYPES.has(type) && Boolean(item.word?.trim()) && Boolean(item.code?.trim())
  })
  if (relevantItems.length === 0) return []

  const affected = new Map<string, { type: PhraseType; code: string }>()
  for (const item of items) {
    const type = normalizeType(item)
    const code = normalizeCode(item.code)
    if (!PRIORITY_TYPES.has(type) || !code) continue
    affected.set(chainKey(type, code), { type, code })
  }
  if (affected.size === 0) return []

  const filters = [...affected.values()].map(({ type, code }) => ({ type, code }))
  const existing = await prisma.phrase.findMany({
    where: { OR: filters, status: 'Finish' },
    select: { word: true, code: true, type: true, weight: true },
  })

  const initial = new Map<string, ChainEntry[]>()
  for (const { type, code } of affected.values()) initial.set(chainKey(type, code), [])
  for (const phrase of existing) {
    const type = (phrase.type || 'Phrase') as PhraseType
    const key = chainKey(type, phrase.code)
    const entries = initial.get(key) || []
    entries.push({
      word: phrase.word,
      code: phrase.code,
      type,
      weight: phrase.weight,
      source: 'existing',
    })
    initial.set(key, entries)
  }

  const finalChains = applyBatchItems(initial, items)
  const warnings: BatchSubmitWarning[] = []
  const seen = new Set<string>()

  for (const item of relevantItems) {
    const type = normalizeType(item)
    const key = chainKey(type, item.code)
    const chain = sortChain(finalChains.get(key) || [])
    const entry = chain.find(candidate => candidate.itemId === item.id)
    if (!entry) continue
    const warning = warningForEntry(entry, chain, item)
    if (!warning) continue
    const warningKey = `${warning.id}:${warning.warningType}:${warning.code}:${warning.word}`
    if (seen.has(warningKey)) continue
    seen.add(warningKey)
    warnings.push(warning)
  }

  return warnings
}
