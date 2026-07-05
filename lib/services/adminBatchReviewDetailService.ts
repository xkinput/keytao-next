import { prisma } from '@/lib/prisma'
import { buildBatchAiReview } from '@/lib/services/batchAiReviewService'

export async function getAdminBatchReviewDetail(id: string) {
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
          dependencies: {
            include: {
              dependsOn: {
                select: {
                  id: true,
                  word: true,
                  code: true,
                },
              },
            },
          },
        },
        orderBy: {
          createAt: 'asc',
        },
      },
    },
  })

  if (!batch) return null

  const { checkBatchConflictsWithWeight } = await import('@/lib/services/batchConflictService')
  type ConflictResult = Awaited<ReturnType<typeof checkBatchConflictsWithWeight>>[number]

  const prItems = batch.pullRequests.map(pr => ({
    id: String(pr.id),
    action: pr.action as 'Create' | 'Change' | 'Delete',
    word: pr.word || '',
    code: pr.code || '',
    oldWord: pr.oldWord || undefined,
    weight: pr.weight || undefined,
    type: pr.type || 'Phrase',
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

    const resolverPR = batch.pullRequests[resolvedSuggestion.resolverIndex]
    const dependentPR = batch.pullRequests[i]
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

  const enrichedPRs = batch.pullRequests.map(pr => {
    const conflictResult = conflictResults.find(result => result.id === String(pr.id))
    return {
      ...pr,
      weight: conflictResult?.calculatedWeight ?? pr.weight,
      conflictInfo: conflictResult?.conflict,
      dependencies: dynamicDepsOf.get(pr.id) ?? [],
      dependedBy: dynamicDependedBy.get(pr.id) ?? [],
    }
  })

  const aiReview = await buildBatchAiReview({
    id: batch.id,
    status: batch.status,
    pullRequests: enrichedPRs,
  })
  const aiItemsByPrId = new Map(aiReview.items.map(item => [item.prId, item]))
  const reviewedPRs = enrichedPRs.map(pr => ({
    ...pr,
    aiReview: aiItemsByPrId.get(pr.id),
  }))

  return {
    ...batch,
    pullRequests: reviewedPRs,
    aiReview,
  }
}
