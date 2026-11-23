import { prisma } from '@/lib/prisma'
import type { BatchConflictResult } from '@/lib/services/batchConflictService'
import { BatchContentLockedError } from '@/lib/services/batchContentGuard'

export const reviewNotesInclude = {
  orderBy: { id: 'desc' as const },
  include: { reviewer: { select: { name: true, nickname: true } } },
}

type ReviewItem = {
  id: number
  status: 'Pending' | 'Approved' | 'Rejected'
  action: string
  word: string | null
  type: string | null
  appliedAt?: Date | null
  dependencies?: Array<{ dependsOnId: number; dependsOn?: { appliedAt: Date | null } }>
}

export function getItemReviewProgress(items: ReviewItem[], conflicts: BatchConflictResult[]) {
  const current = items.filter(item => !item.appliedAt)
  const byId = new Map(items.map(item => [item.id, item]))
  const byIndex = new Map(current.map((item, index) => [item.id, index]))
  const creates = new Map<string, number[]>()
  const edges = new Map<number, Set<number>>()
  const blocked = new Set<number>()
  const connects = (from: number, to: number) => {
    if (!byIndex.has(from) || !byIndex.has(to) || from === to) return
    const a = edges.get(from) ?? new Set<number>()
    const b = edges.get(to) ?? new Set<number>()
    a.add(to)
    b.add(from)
    edges.set(from, a)
    edges.set(to, b)
  }
  const wordKey = (item: ReviewItem) => JSON.stringify([item.word, item.type ?? 'Phrase'])
  for (const item of current) {
    if (item.action === 'Create' && item.word) {
      const key = wordKey(item)
      const same = creates.get(key) ?? []
      same.push(item.id)
      creates.set(key, same)
    }
    for (const dependency of item.dependencies ?? []) {
      if (!byId.has(dependency.dependsOnId) && !dependency.dependsOn?.appliedAt && item.status === 'Approved') {
        blocked.add(item.id)
      }
      connects(item.id, dependency.dependsOnId)
    }
  }
  for (const item of current) {
    if (item.action === 'Delete' && item.word) {
      for (const sibling of creates.get(wordKey(item)) ?? []) connects(item.id, sibling)
    }
  }
  for (const { id, conflict } of conflicts) {
    for (const suggestion of conflict.suggestions ?? []) {
      if (suggestion.action !== 'Resolved' || suggestion.resolverIndex === undefined) continue
      const resolver = current[suggestion.resolverIndex]
      if (resolver) connects(Number(id), resolver.id)
    }
  }
  const dependencyPendingIds: number[] = []
  const visited = new Set<number>()
  let dependencyConflictCount = blocked.size
  for (const entry of current) {
    if (visited.has(entry.id)) continue
    const group = [entry.id]
    visited.add(entry.id)
    for (let i = 0; i < group.length; i++) {
      for (const next of edges.get(group[i]) ?? []) {
        if (visited.has(next)) continue
        visited.add(next)
        group.push(next)
      }
    }
    const states = new Set(group.map(id => byId.get(id)!.status))
    const mixed = states.has('Approved') && states.has('Rejected')
    if (mixed) dependencyConflictCount++
    if (mixed || group.some(id => blocked.has(id)) || (group.length > 1 && states.has('Pending'))) {
      dependencyPendingIds.push(...group)
    }
  }
  const pendingCount = current.filter(item => item.status === 'Pending').length
  return {
    pendingCount,
    dependencyConflictCount,
    dependencyPendingIds,
    canFinalize: current.length > 0 && pendingCount === 0 && dependencyConflictCount === 0,
  }
}

export class ItemReviewError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

export async function recordItemReview(input: {
  batchId: string
  itemId: number
  reviewerId: number
  decision: 'Approved' | 'Rejected'
  reason: string
  expectedContentVersion: number
}) {
  return prisma.$transaction(async tx => {
    const changed = await tx.batch.updateMany({
      where: { id: input.batchId, status: 'Submitted', contentVersion: input.expectedContentVersion },
      data: { itemReviewStarted: true, contentVersion: { increment: 1 } },
    })
    if (changed.count !== 1) throw new BatchContentLockedError()
    const item = await tx.pullRequest.findFirst({
      where: { id: input.itemId, batchId: input.batchId },
      select: { id: true, appliedAt: true },
    })
    if (!item) throw new ItemReviewError('词条不属于此批次', 404)
    if (item.appliedAt) throw new ItemReviewError('词条已应用，不能更改审核决定', 409)
    return tx.pullRequest.update({
      where: { id: item.id },
      data: {
        status: input.decision,
        reviewNotes: { create: { decision: input.decision, reason: input.reason, reviewerId: input.reviewerId } },
      },
      include: { reviewNotes: reviewNotesInclude },
    })
  })
}

export async function resubmitRejectedItem(batchId: string, itemId: number, userId: number, version: number) {
  return prisma.$transaction(async tx => {
    const batch = await tx.batch.findUnique({
      where: { id: batchId },
      select: { creatorId: true, status: true, syncTaskId: true, syncTask: { select: { status: true } } },
    })
    if (!batch) throw new ItemReviewError('批次不存在', 404)
    if (batch.creatorId !== userId) throw new ItemReviewError('无权限', 403)
    if (!['Submitted', 'Rejected', 'Approved'].includes(batch.status)) {
      throw new ItemReviewError('当前批次不能重新送审', 409)
    }
    if (batch.syncTask && batch.syncTask.status !== 'Completed') {
      throw new ItemReviewError('请先处理本批次的同步任务，再重新送审词条', 409)
    }
    const changed = await tx.batch.updateMany({
      where: { id: batchId, creatorId: userId, status: batch.status, contentVersion: version, syncTaskId: batch.syncTaskId },
      data: { status: 'Submitted', itemReviewStarted: true, contentVersion: { increment: 1 } },
    })
    if (changed.count !== 1) throw new BatchContentLockedError()
    const item = await tx.pullRequest.findFirst({
      where: { id: itemId, batchId }, select: { status: true, appliedAt: true },
    })
    if (!item) throw new ItemReviewError('词条不属于此批次', 404)
    if (item.status !== 'Rejected' || item.appliedAt) throw new ItemReviewError('只能重新送审被拒绝的词条', 409)
    await tx.pullRequest.update({
      where: { id: itemId },
      data: { status: 'Pending', likedBy: { set: [] }, dislikedBy: { set: [] } },
    })
  })
}
