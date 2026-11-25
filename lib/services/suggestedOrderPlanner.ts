import { getDefaultWeight } from '@/lib/constants/phraseTypes'
import type { BatchAiReviewChainEntry as ChainEntry } from '@/lib/types/batchAiReview'

const MIN_WEIGHT = -2147483648
const MAX_WEIGHT = 2147483647

export function compareChainEntry(a: ChainEntry, b: ChainEntry): number {
  const weightA = a.weight ?? Number.MAX_SAFE_INTEGER
  const weightB = b.weight ?? Number.MAX_SAFE_INTEGER
  if (weightA !== weightB) return weightA - weightB
  return a.word.localeCompare(b.word, 'zh-Hans-CN')
}

type WeightUpdate = { prId: number; weight: number }
type OrderPlan = { updates: WeightUpdate[] }
  | { error: 'order_requires_current_phrase_change' | 'no_weight_gap' | 'duplicate_word'; message?: string }

export function writablePrId(entry: ChainEntry) {
  return entry.source === 'draft' && (entry.action === 'Create' || entry.action === 'Change')
    && Number.isInteger(entry.prId) && entry.prId! > 0 ? entry.prId : undefined
}

function planDraftWeights(
  entries: ChainEntry[], lower: number, upper: number, reserved: ReadonlySet<number>,
  nullCreateIds: ReadonlySet<number>, updates: WeightUpdate[],
) {
  if (!entries.length) return lower < upper
  const minimum = getDefaultWeight(entries[0].type)
  const anchors = [lower, ...entries.map(({ weight }) => weight !== null && reserved.has(weight) ? null : weight), upper]
  const end = anchors.length - 1
  const retained = anchors.map(() => -Infinity)
  const nextAnchor = anchors.map(() => -1)
  retained[end] = 0

  const skipReserved = (weight: number, step: 1 | -1) => {
    while (reserved.has(weight)) weight += step
    return weight
  }

  // Keep as many stored weights as possible, including legacy weights below the write minimum.
  for (let i = end - 1; i >= 0; i--) {
    const weight = anchors[i]
    if (weight === null || !Number.isInteger(weight)) continue
    let lastNeeded = weight
    for (let j = i + 1; j <= end; j++) {
      const nextWeight = anchors[j]
      if (nextWeight !== null && nextWeight > lastNeeded && retained[j] + 1 > retained[i]) {
        retained[i] = retained[j] + 1
        nextAnchor[i] = j
      }
      lastNeeded = skipReserved(Math.max(lastNeeded + 1, minimum), 1)
    }
  }

  if (nextAnchor[0] < 0) return false
  for (let i = 0; i < end; i = nextAnchor[i]) {
    const j = nextAnchor[i]
    const latest = []
    let max = anchors[j]!
    for (let index = j - 1; index > i; index--) {
      max = skipReserved(max - 1, -1)
      latest[index - i - 1] = max
    }
    let min = Math.max(anchors[i]! + 1, minimum)
    for (let index = i + 1; index < j; index++) {
      const entry = entries[index - 1]
      const preferred = Number.isInteger(entry.weight) ? entry.weight! : minimum
      const weight = skipReserved(Math.max(min, Math.min(preferred, latest[index - i - 1])), 1)
      updates.push({ prId: entry.prId!, weight })
      min = weight + 1
    }
    if (j < end && nullCreateIds.has(entries[j - 1].prId!)) {
      updates.push({ prId: entries[j - 1].prId!, weight: anchors[j]! })
    }
  }

  return true
}

export function planChainOrder(
  after: ChainEntry[], orderedWords: string[], originalWeights: readonly number[] = [],
  nullCreateIds: ReadonlySet<number> = new Set(),
): OrderPlan {
  const byWord = new Map(after.map(entry => [entry.word, entry]))
  if (byWord.size !== after.length) {
    const liveWords = new Set(after.filter(entry => entry.source === 'current').map(entry => entry.word))
    const change = after.find(entry => entry.source === 'draft' && entry.action === 'Change' &&
      entry.oldWord && entry.oldWord !== entry.word && liveWords.has(entry.word))
    if (change) {
      return { error: 'duplicate_word', message: `改词后的「${change.word}」已在此编码上，请改为删除「${change.oldWord}」` }
    }
    return { error: 'duplicate_word' }
  }
  if (new Set(orderedWords).size !== orderedWords.length) {
    return { error: 'duplicate_word' }
  }
  if (orderedWords.length !== after.length || orderedWords.some(word => !byWord.has(word))) {
    return { error: 'order_requires_current_phrase_change' }
  }

  const ordered = orderedWords.map(word => byWord.get(word)!)
  const fixed = ordered.filter(entry => writablePrId(entry) === undefined)
  if (fixed.some((entry, index) => index > 0 && compareChainEntry(fixed[index - 1], entry) > 0) ||
      ordered.some((entry, index) => entry.weight === null && writablePrId(entry) === undefined && index !== ordered.length - 1)) {
    return { error: 'order_requires_current_phrase_change' }
  }

  const currentWeights = after.flatMap(entry => entry.source === 'current' && entry.weight !== null ? [entry.weight] : [])
  // A rejected Delete or Change leaves its original weight occupied.
  const reserved = new Set([...originalWeights, ...currentWeights])
  const isNullCreate = (entry: ChainEntry) => entry.action === 'Create' && writablePrId(entry) !== undefined &&
    (entry.weight === null || nullCreateIds.has(entry.prId!))
  let end = ordered.length
  let limit = MAX_WEIGHT + 1
  const tail = ordered.at(-1)
  if (tail && isNullCreate(tail)) {
    end--
    // Approval can reorder dependent rows, so the relative order of two dynamic appends is not guaranteed.
    if (end > 0 && isNullCreate(ordered[end - 1])) return { error: 'no_weight_gap' }
    const base = getDefaultWeight(tail.type)
    if (Math.max(base - 1, ...reserved) + after.filter(entry => entry.action === 'Create').length > MAX_WEIGHT) {
      return { error: 'no_weight_gap' }
    }
    // Approval appends after live weights and may ignore explicit draft weights.
    limit = 1 + (currentWeights.length ? Math.max(...currentWeights) : Math.min(base - 1, ...reserved))
  }

  const updates: WeightUpdate[] = []
  let start = 0
  let lower = MIN_WEIGHT - 1
  for (let i = 0; i <= end; i++) {
    const entry = i < end ? ordered[i] : undefined
    if (entry && writablePrId(entry) !== undefined) continue
    const upper = entry?.weight ?? limit
    if (entry?.weight != null && (upper < MIN_WEIGHT || upper > MAX_WEIGHT || !Number.isInteger(upper))) {
      return { error: 'no_weight_gap' }
    }
    if (!planDraftWeights(ordered.slice(start, i), lower, upper, reserved, nullCreateIds, updates)) {
      return { error: 'no_weight_gap' }
    }
    if (entry?.weight === null) break
    start = i + 1
    lower = upper
  }
  return { updates }
}
