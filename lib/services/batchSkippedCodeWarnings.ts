import { prisma } from '@/lib/prisma'
import type { PhraseType } from '@/lib/constants/phraseTypes'
import type { BatchPRItem } from './batchConflictService'
import type { BatchSubmitWarning } from './batchSubmitWarnings'
import { encodePhrase } from './keytaoEncoder'

interface CandidateSlotAnalysis {
  id: string
  item: BatchPRItem
  targetCode: string
  priorCodes: string[]
}

const CODE_ONLY_PATTERN = /^[a-z]+$/i
const HAN_PATTERN = /[\u3400-\u9fff]/
const SKIPPED_SLOT_TYPES = new Set<PhraseType>(['Single', 'Phrase', 'Supplement'])

function normalizeItemType(item: BatchPRItem): PhraseType {
  return (item.type || 'Phrase') as PhraseType
}

function slotKey(type: PhraseType, code: string): string {
  return `${type}:${code}`
}

function uniqueCodes(codes: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const rawCode of codes) {
    const code = rawCode.trim().toLowerCase()
    if (!code || seen.has(code)) continue
    seen.add(code)
    result.push(code)
  }
  return result
}

function candidateSeriesForTarget(
  targetCode: string,
  seriesList: string[][]
): string[] {
  for (const series of seriesList) {
    const normalized = uniqueCodes(series)
    if (normalized.includes(targetCode)) return normalized
  }
  return []
}

async function analyzeItem(item: BatchPRItem): Promise<CandidateSlotAnalysis | null> {
  const type = normalizeItemType(item)
  const word = item.word.trim()
  const targetCode = item.code.trim().toLowerCase()

  if (item.action === 'Delete') return null
  if (!word || !targetCode || !CODE_ONLY_PATTERN.test(targetCode)) return null
  if (!SKIPPED_SLOT_TYPES.has(type) || !HAN_PATTERN.test(word)) return null

  try {
    const encoding = await encodePhrase(word)
    const series = candidateSeriesForTarget(targetCode, [
      encoding.codes,
      ...encoding.flyKeyVariants.map(variant => variant.codes),
    ])
    const targetIndex = series.indexOf(targetCode)
    if (targetIndex <= 0) return null
    return {
      id: item.id,
      item,
      targetCode,
      priorCodes: series.slice(0, targetIndex),
    }
  } catch (error) {
    console.warn('[batchSkippedCodeWarnings] encode failed:', {
      word,
      targetCode,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

export async function buildSkippedCandidateSlotWarnings(
  items: BatchPRItem[]
): Promise<BatchSubmitWarning[]> {
  const analyses = (await Promise.all(items.map(analyzeItem)))
    .filter((item): item is CandidateSlotAnalysis => item !== null)

  if (analyses.length === 0) return []

  const relevantSlots = new Set<string>()
  for (const analysis of analyses) {
    const type = normalizeItemType(analysis.item)
    for (const code of analysis.priorCodes) {
      relevantSlots.add(slotKey(type, code))
    }
  }

  if (relevantSlots.size === 0) return []

  const slotFilters = [...relevantSlots].map(key => {
    const [type, code] = key.split(':') as [PhraseType, string]
    return { type, code }
  })

  const existingPhrases = await prisma.phrase.findMany({
    where: { OR: slotFilters },
    select: { code: true, type: true },
  })

  const occupancyCounts = new Map<string, number>()
  for (const phrase of existingPhrases) {
    const type = (phrase.type || 'Phrase') as PhraseType
    const key = slotKey(type, phrase.code)
    occupancyCounts.set(key, (occupancyCounts.get(key) || 0) + 1)
  }

  for (const item of items) {
    const code = item.code.trim().toLowerCase()
    if (!code) continue

    const key = slotKey(normalizeItemType(item), code)
    if (!relevantSlots.has(key)) continue

    if (item.action === 'Delete') {
      occupancyCounts.set(key, (occupancyCounts.get(key) || 0) - 1)
    } else if (item.action === 'Create') {
      occupancyCounts.set(key, (occupancyCounts.get(key) || 0) + 1)
    }
  }

  const warnings: BatchSubmitWarning[] = []
  for (const analysis of analyses) {
    const type = normalizeItemType(analysis.item)
    const skippedCodes = analysis.priorCodes.filter(code => (occupancyCounts.get(slotKey(type, code)) || 0) <= 0)
    if (skippedCodes.length === 0) continue

    const skippedCode = skippedCodes[0]
    warnings.push({
      id: analysis.id,
      word: analysis.item.word,
      code: analysis.targetCode,
      weight: analysis.item.weight,
      warningType: 'skipped_candidate_slot',
      skippedCode,
      skippedCodes,
      impact: `编码链中更短候选 "${skippedCode}" 仍是空位，你正在跳过它直接把「${analysis.item.word}」加到更长编码 "${analysis.targetCode}"。这会让编码链留下空位，不建议这样操作；建议先使用 "${skippedCode}"，若确有特殊排序或避让原因，再确认继续。`,
    })
  }

  return warnings
}
