import { prisma } from '@/lib/prisma'
import { buildSuggestedOrderChains, computeChainDigest } from '@/lib/services/batchAiReviewService'
import { computeReviewDigest } from '@/lib/services/batchBotReviewService'
import { getItemReviewProgress, reviewNotesInclude } from '@/lib/services/batchItemReview'
import { parseMiaomiaoReviewRemark } from '@/lib/services/miaomiaoReviewRemark'
import { planChainOrder } from '@/lib/services/suggestedOrderService'

export async function getAdminBatchReviewDetail(id: string, includeVoteCounts = false) {
  const batch = await prisma.batch.findUnique({
    where: { id },
    include: {
      creator: {
        select: {
          id: true,
          name: true,
          nickname: true,
        },
      },
      sourceIssue: {
        select: {
          id: true,
          title: true,
        },
      },
      pullRequests: {
        include: {
          phrase: true,
          conflicts: true,
          reviewNotes: reviewNotesInclude,
          _count: includeVoteCounts ? { select: { likedBy: true, dislikedBy: true } } : undefined,
          dependencies: {
            include: {
              dependsOn: {
                select: {
                  id: true,
                  word: true,
                  code: true,
                  appliedAt: true,
                },
              },
            },
          },
        },
        orderBy: [{ createAt: 'asc' }, { id: 'asc' }],
      },
    },
  })

  if (!batch) return null

  const { checkBatchConflictsWithWeight } = await import('@/lib/services/batchConflictService')
  type ConflictResult = Awaited<ReturnType<typeof checkBatchConflictsWithWeight>>[number]

  const currentItems = batch.pullRequests.filter(pr => !pr.appliedAt)
  const prItems = currentItems.map(pr => ({
    id: String(pr.id),
    action: pr.action,
    word: pr.word || '',
    code: pr.code || '',
    oldWord: pr.oldWord || undefined,
    weight: pr.weight ?? undefined,
    type: pr.type || 'Phrase' as const,
  }))

  let conflictResults: ConflictResult[] = []
  if (prItems.length > 0) {
    conflictResults = await checkBatchConflictsWithWeight(prItems)
  }

  const dynamicDepsOf = new Map<number, Array<{
    dependsOn: { id: number; word: string; code: string }
    reason: string
  }>>()
  const dynamicDependedBy = new Map<number, Array<{
    dependent: { id: number; word: string; code: string }
    reason: string
  }>>()

  for (let i = 0; i < conflictResults.length; i++) {
    const resolvedSuggestion = conflictResults[i].conflict.suggestions?.find(
      (suggestion: { action?: string }) => suggestion.action === 'Resolved'
    )
    if (resolvedSuggestion?.resolverIndex === undefined) continue

    const resolverPR = currentItems[resolvedSuggestion.resolverIndex]
    const dependentPR = currentItems[i]
    if (!resolverPR || !dependentPR || resolverPR.id === dependentPR.id) continue

    const reason = resolvedSuggestion.reason || '批次内操作解决了冲突'
    const depEntry = {
      dependsOn: {
        id: resolverPR.id,
        word: resolverPR.word || '',
        code: resolverPR.code || '',
      },
      reason,
    }
    const byEntry = {
      dependent: {
        id: dependentPR.id,
        word: dependentPR.word || '',
        code: dependentPR.code || '',
      },
      reason,
    }

    if (!dynamicDepsOf.has(dependentPR.id)) dynamicDepsOf.set(dependentPR.id, [])
    dynamicDepsOf.get(dependentPR.id)!.push(depEntry)

    if (!dynamicDependedBy.has(resolverPR.id)) dynamicDependedBy.set(resolverPR.id, [])
    dynamicDependedBy.get(resolverPR.id)!.push(byEntry)
  }

  const conflictsById = new Map(conflictResults.map(result => [result.id, result]))
  const reviewsById = new Map(batch.pullRequests.map(pr => [pr.id, parseMiaomiaoReviewRemark(pr.remark).review]))
  const enrichedPRs = batch.pullRequests.map(pr => {
    const conflictResult = conflictsById.get(String(pr.id))
    const reviewDigest = reviewsById.get(pr.id)?.reviewDigest
    return {
      ...pr,
      reviewFresh: Boolean(reviewDigest && reviewDigest === computeReviewDigest(pr)),
      weight: conflictResult?.calculatedWeight ?? pr.weight,
      conflictInfo: conflictResult?.conflict,
      dependencies: [...pr.dependencies, ...(dynamicDepsOf.get(pr.id) ?? [])
        .filter(entry => !pr.dependencies.some(dependency => dependency.dependsOnId === entry.dependsOn.id))],
      dependedBy: dynamicDependedBy.get(pr.id) ?? [],
    }
  })

  const suggestions = batch.status === 'Submitted' ? currentItems.flatMap(pr => {
    const order = reviewsById.get(pr.id)?.suggestedOrder
    return order ? [order] : []
  }) : []
  const slotKey = ({ code, type }: { code: string; type: string }) => JSON.stringify([code, type])
  const chains = suggestions.length ? await buildSuggestedOrderChains(enrichedPRs.filter(pr => !pr.appliedAt), suggestions) : []
  const chainsBySlot = new Map(chains.map(chain => [slotKey(chain), {
    ...chain, digest: computeChainDigest(chain.after),
  }]))
  const nullCreateIds = new Set(currentItems.filter(pr => pr.action === 'Create' && pr.weight === null).map(pr => pr.id))

  const progress = getItemReviewProgress(batch.pullRequests, conflictResults)
  return {
    ...batch,
    pullRequests: enrichedPRs.map(pr => {
      const order = reviewsById.get(pr.id)?.suggestedOrder
      if (!order) return pr
      const chain = chainsBySlot.get(slotKey(order))
      return { ...pr, suggestedOrderApplicable: Boolean(!pr.appliedAt && chain && chain.digest === order.chainDigest &&
        chain.after.some((entry, index) => entry.word !== order.orderedWords[index]) &&
        'updates' in planChainOrder(chain.after, order.orderedWords, chain.originalWeights, nullCreateIds)) }
    }),
    reviewProgress: { ...progress, canFinalize: batch.status === 'Submitted' && progress.canFinalize },
  }
}
