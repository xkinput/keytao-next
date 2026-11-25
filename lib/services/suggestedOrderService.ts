import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { getDefaultWeight } from '@/lib/constants/phraseTypes'
import type { BatchAiReviewChainEntry as ChainEntry } from '@/lib/types/batchAiReview'
import { buildSuggestedOrderChains, compareChainEntry, computeChainDigest } from './batchAiReviewService'
import { computeReviewDigest } from './batchBotReviewService'
import { BatchContentLockedError, claimBatchContentMutation, EDITABLE_BATCH_STATUSES } from './batchContentGuard'
import { ItemReviewError, reviewNotesInclude } from './batchItemReview'
import { parseMiaomiaoReviewRemark, rewriteMiaomiaoOrderRemark } from './miaomiaoReviewRemark'
import { lockPhraseWeightSlots } from './phraseWeightLock'
import { resetVotesForProposalEdit } from './pullRequestVotes'

const MIN_WEIGHT = -2147483648
const MAX_WEIGHT = 2147483647
const CHAIN_CHANGED = '编码链已变化，请重新复审'
const MANUAL_ORDER_ERRORS = {
  order_requires_current_phrase_change: '只能调整本批词条，现有词条位置不能移动',
  no_weight_gap: '没有可用的权重间隔',
}

type WeightUpdate = { prId: number; weight: number }
type OrderPlan = { updates: WeightUpdate[] } | { error: 'order_requires_current_phrase_change' | 'no_weight_gap' }

function writablePrId(entry: ChainEntry) {
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
  if (orderedWords.length !== after.length || byWord.size !== after.length ||
      new Set(orderedWords).size !== after.length || orderedWords.some(word => !byWord.has(word))) {
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

export async function applySuggestedOrder(input: {
  batchId: string
  itemId: number
  chainDigest: string
  expectedContentVersion: number
}) {
  const { batchId, itemId, chainDigest, expectedContentVersion } = input
  return prisma.$transaction(tx => applyChainOrder(tx, {
    batchId, itemId, chainDigest, remarkMode: 'restamp',
    claimOptions: { expectedContentVersion, allowSuggestedOrderDuringItemReview: true },
  }))
}

export type ChainReorderTarget = { beforePrId: number | null; afterWord?: never }
  | { afterWord: string | null; beforePrId?: never }

export function moveChainEntry(after: ChainEntry[], movedPrId: number, target: ChainReorderTarget): string[] {
  const moved = after.find(entry => writablePrId(entry) === movedPrId)
  if (!moved) throw new BatchContentLockedError(MANUAL_ORDER_ERRORS.order_requires_current_phrase_change)
  const destination = target.beforePrId !== undefined ? target.beforePrId : target.afterWord
  if (destination === movedPrId) return after.map(entry => entry.word)
  const remaining = after.filter(entry => entry !== moved)
  const index = destination === null ? remaining.length : remaining.findIndex(entry =>
    typeof destination === 'number' ? writablePrId(entry) === destination
      : entry.source === 'current' && entry.word === destination,
  )
  if (index < 0) throw new BatchContentLockedError('编码链已变化，请刷新后重试')
  remaining.splice(index, 0, moved)
  return remaining.map(entry => entry.word)
}

export async function reorderBatchChain(input: {
  batchId: string
  code: string
  type: string
  movedPrId: number
  target: ChainReorderTarget
  expectedContentVersion: number
  userId: number
  isAdmin: boolean
}) {
  const { batchId, code, type, movedPrId, target, expectedContentVersion, userId, isAdmin } = input
  return prisma.$transaction(async tx => {
    const batch = await tx.batch.findUnique({ where: { id: batchId }, select: { creatorId: true, status: true } })
    if (!batch) throw new ItemReviewError('批次不存在', 404)
    if (!isAdmin && (batch.creatorId !== userId || batch.status === 'Submitted')) {
      throw new ItemReviewError('权限不足', 403)
    }
    if (batch.status === 'Approved') throw new BatchContentLockedError('已批准的批次不能调整顺序')

    return applyChainOrder(tx, {
      batchId, code, type, remarkMode: 'manual',
      orderedWords: after => moveChainEntry(after, movedPrId, target),
      claimOptions: isAdmin
        ? batch.status === 'Submitted'
          ? { expectedContentVersion, allowSuggestedOrderDuringItemReview: true }
          : { expectedContentVersion, allowedStatuses: EDITABLE_BATCH_STATUSES }
        : { expectedContentVersion, creatorId: userId },
    })
  })
}

async function applyChainOrder(tx: Prisma.TransactionClient, input: {
  batchId: string
  claimOptions: Parameters<typeof claimBatchContentMutation>[2]
} & ({ remarkMode: 'restamp'; itemId: number; chainDigest: string }
  | { remarkMode: 'manual'; code: string; type: string; orderedWords: (after: ChainEntry[]) => string[] })) {
  const { batchId, claimOptions, remarkMode } = input
  await claimBatchContentMutation(tx, batchId, claimOptions)
  const rows = await tx.pullRequest.findMany({
    where: { batchId },
    include: { phrase: true },
    orderBy: [{ createAt: 'asc' }, { id: 'asc' }],
  })
  const order = (() => {
    if (input.remarkMode === 'manual') return input
    const target = rows.find(row => row.id === input.itemId)
    if (!target) throw new ItemReviewError('词条不属于此批次', 404)
    const order = parseMiaomiaoReviewRemark(target.remark).review?.suggestedOrder
    if (target.appliedAt || !order || order.chainDigest !== input.chainDigest) throw new BatchContentLockedError(CHAIN_CHANGED)
    return order
  })()

  await lockPhraseWeightSlots(tx, [order])
  const activeRows = rows.filter(row => !row.appliedAt)
  const [chain] = await buildSuggestedOrderChains(activeRows, [order], tx)
  if (input.remarkMode === 'restamp' && (!chain || computeChainDigest(chain.after) !== input.chainDigest)) {
    throw new BatchContentLockedError(CHAIN_CHANGED)
  }
  if (!chain) throw new BatchContentLockedError(MANUAL_ORDER_ERRORS.order_requires_current_phrase_change)
  const orderedWords = typeof order.orderedWords === 'function' ? order.orderedWords(chain.after) : order.orderedWords
  const nullCreateIds = new Set(activeRows.filter(row => row.action === 'Create' && row.weight === null).map(row => row.id))
  const plan = planChainOrder(chain.after, orderedWords, chain.originalWeights, nullCreateIds)
  if ('error' in plan) throw new BatchContentLockedError(remarkMode === 'manual' ? MANUAL_ORDER_ERRORS[plan.error] : plan.error)
  if (chain.after.every((entry, index) => entry.word === orderedWords[index])) {
    throw new BatchContentLockedError(remarkMode === 'manual' ? '词条顺序未变化' : CHAIN_CHANGED)
  }

  const weightById = new Map(plan.updates.map(({ prId, weight }) => [prId, weight]))
  const items = []
  for (const row of activeRows) {
    const weight = weightById.get(row.id)
    const digest = weight === undefined ? undefined : remarkMode === 'manual'
      ? weight === row.weight ? undefined : 'remove'
      : {
        before: computeReviewDigest(row),
        after: computeReviewDigest({ ...row, weight }),
      }
    const remark = rewriteMiaomiaoOrderRemark(row.remark, order, digest)
    if (weight === undefined && remark === row.remark) continue
    const saved = await tx.pullRequest.update({
      where: { id: row.id, batchId },
      data: { weight, remark, ...resetVotesForProposalEdit(row, { weight }) },
      include: { reviewNotes: reviewNotesInclude, _count: { select: { likedBy: true, dislikedBy: true } } },
    })
    const { id, status, reviewNotes, _count } = saved
    const savedDigest = parseMiaomiaoReviewRemark(saved.remark).review?.reviewDigest
    items.push({ id, status, reviewNotes, _count, weight: saved.weight, remark: saved.remark,
      reviewFresh: !!savedDigest && savedDigest === computeReviewDigest(saved),
    })
  }
  return { contentVersion: claimOptions.expectedContentVersion + 1, items }
}
