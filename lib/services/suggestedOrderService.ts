import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import type { BatchAiReviewChainEntry as ChainEntry } from '@/lib/types/batchAiReview'
import { buildSuggestedOrderChains, computeChainDigest } from './batchAiReviewService'
import { planChainOrder, writablePrId } from './suggestedOrderPlanner'
import { computeReviewDigest } from './batchBotReviewService'
import { BatchContentLockedError, claimBatchContentMutation, EDITABLE_BATCH_STATUSES } from './batchContentGuard'
import { ItemReviewError, reviewNotesInclude } from './batchItemReview'
import { parseMiaomiaoReviewRemark, rewriteMiaomiaoOrderRemark } from './miaomiaoReviewRemark'
import { lockPhraseWeightSlots } from './phraseWeightLock'
import { resetVotesForProposalEdit } from './pullRequestVotes'

export { planChainOrder } from './suggestedOrderPlanner'

const CHAIN_CHANGED = '编码链已变化，请重新复审'
const ORDER_ERRORS = {
  order_requires_current_phrase_change: '需要移动已上线词条，请改为新增一条修改',
  no_weight_gap: '相邻权重没有空位，请先调整相邻词条',
  duplicate_word: '同码链中有重复词，请先合并重复项',
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
  if (!moved) throw new BatchContentLockedError(ORDER_ERRORS.order_requires_current_phrase_change)
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
  if (!chain) throw new BatchContentLockedError(ORDER_ERRORS.order_requires_current_phrase_change)
  const orderedWords = typeof order.orderedWords === 'function' ? order.orderedWords(chain.after) : order.orderedWords
  const nullCreateIds = new Set(activeRows.filter(row => row.action === 'Create' && row.weight === null).map(row => row.id))
  const plan = planChainOrder(chain.after, orderedWords, chain.originalWeights, nullCreateIds)
  if ('error' in plan) throw new BatchContentLockedError(ORDER_ERRORS[plan.error])
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
