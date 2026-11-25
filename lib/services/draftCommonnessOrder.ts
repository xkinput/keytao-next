import { CODE_PATTERN } from '@/lib/constants/codeValidation'
import { getDefaultWeight, isValidPhraseType } from '@/lib/constants/phraseTypes'
import type { BatchAiReviewChainEntry } from '@/lib/types/batchAiReview'
import {
  COMMONNESS_ORDER_LIMITS as limits, draftOrderKey, isCommonnessOrderWord,
  type CommonnessOrderChain, type CommonnessOrderResult, type CommonnessOrderSlot,
} from '@/lib/types/commonnessOrder'
import { planChainOrder } from './suggestedOrderPlanner'

export interface DraftOrderItem {
  fieldId: string
  prId?: number
  action: 'Create' | 'Change' | 'Delete'
  word: string
  oldWord: string
  code: string
  type: string
  weight: string
}

interface DraftSlot extends CommonnessOrderSlot {
  items: DraftOrderItem[]
}

type LiveOccupant = { word: string; weight: number }

interface PreparedChain {
  request: CommonnessOrderChain
  items: DraftOrderItem[]
  entries: BatchAiReviewChainEntry[]
  originalWeights: number[]
}

export function getDraftCodeFills(
  requested: DraftOrderItem[],
  current: DraftOrderItem[],
  results: readonly { word: string; suggestion: string | null }[],
) {
  const requestedById = new Map(requested.map(item => [item.fieldId, item]))
  const suggestions = new Map(results.map(result => [result.word, result.suggestion]))
  return current.flatMap(item => {
    const original = requestedById.get(item.fieldId)
    if (!original || original.action === 'Delete' || item.action !== original.action
        || item.word !== original.word || item.type !== original.type || original.code || item.code) return []
    const code = suggestions.get(item.word)
    return code ? [{ fieldId: item.fieldId, code }] : []
  })
}

export function groupDraftOrderItems(items: DraftOrderItem[]) {
  const slots = new Map<string, DraftSlot>()
  for (const item of items) {
    const { code, type } = item
    if (item.action === 'Delete' || !item.word || !isValidPhraseType(type)
        || code.length > limits.codeLength || !CODE_PATTERN.test(code)) continue
    const key = draftOrderKey(code, type)
    const slot = slots.get(key) ?? { code, type, items: [] }
    slot.items.push(item)
    slots.set(key, slot)
  }
  return slots
}

export function buildDraftOrderChains(
  slots: ReadonlyMap<string, DraftSlot>,
  liveBySlot: ReadonlyMap<string, readonly LiveOccupant[]>,
) {
  const chains: PreparedChain[] = []
  const words = new Set<string>()
  for (const [key, { code, type, items }] of slots) {
    if (chains.length === limits.chains) break
    const live = liveBySlot.get(key)
    if (!live || items.length > limits.entries) continue

    const replacedWords = new Set(items.filter(item => item.action === 'Change').map(item => item.oldWord))
    const entries: BatchAiReviewChainEntry[] = live
      .filter(entry => !replacedWords.has(entry.word))
      .map(entry => ({ ...entry, code, type, source: 'current' }))
    const minimum = getDefaultWeight(type)
    items.forEach((item, index) => {
      const preferred = parseInt(item.weight)
      entries.push({
        word: item.word, code, type, source: 'draft', action: item.action, prId: index + 1,
        weight: Number.isSafeInteger(preferred) ? Math.max(minimum, preferred) : minimum,
      })
    })

    const chainWords = new Set(entries.map(entry => entry.word))
    if (entries.length < 2 || entries.length > limits.entries || chainWords.size !== entries.length
        || entries.some(entry => !isCommonnessOrderWord(entry.word))) continue
    const newWords = [...chainWords].filter(word => !words.has(word))
    if (words.size + newWords.length > limits.words) continue

    newWords.forEach(word => words.add(word))
    chains.push({
      entries,
      items,
      originalWeights: live.map(entry => entry.weight),
      request: {
        code, type,
        entries: entries.map(({ word, weight, source, prId }) => {
          const item = prId === undefined ? undefined : items[prId - 1]
          return {
            word, weight: item && !item.weight.trim() ? null : weight, source,
            ...(item?.prId === undefined ? {} : { prId: item.prId }),
          }
        }),
      },
    })
  }
  return chains
}

export function planDraftOrderWeights(
  chain: PreparedChain, result: CommonnessOrderResult, reservedWeights: readonly number[] = [],
) {
  if (result.status !== 'reorder') return []
  const plan = planChainOrder(chain.entries, result.orderedWords, [...chain.originalWeights, ...reservedWeights])
  if ('error' in plan) return null

  const weights = new Map(plan.updates.map(({ prId, weight }) => [prId, weight]))
  return chain.entries.flatMap(entry => {
    if (entry.source !== 'draft' || entry.prId === undefined) return []
    const item = chain.items[entry.prId - 1]
    const weight = String(weights.get(entry.prId) ?? entry.weight)
    if (parseInt(item.weight) === Number(weight)) return []
    return [{ fieldId: item.fieldId, weight }]
  })
}
