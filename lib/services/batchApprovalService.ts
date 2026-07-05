import { prisma } from '@/lib/prisma'
import type { Batch } from '@prisma/client'
import type { BatchConflictResult } from '@/lib/services/batchConflictService'

export type BatchApprovalMode = 'admin' | 'bot-auto'

export interface ApproveSubmittedBatchOptions {
  batchId: string
  reviewNote?: string | null
  mode?: BatchApprovalMode
  allowDelete?: boolean
}

export interface ApproveSubmittedBatchResult {
  batch: Batch
}

export function orderPullRequestsForApproval<T extends { id: number }>(
  pullRequests: T[],
  conflictResults: BatchConflictResult[]
): T[] {
  const indexById = new Map(pullRequests.map((pr, index) => [String(pr.id), index]))
  const edges = new Map<number, Set<number>>()
  const indegree = Array.from({ length: pullRequests.length }, () => 0)

  for (const result of conflictResults) {
    const dependentIndex = indexById.get(result.id)
    if (dependentIndex === undefined) continue

    for (const suggestion of result.conflict.suggestions ?? []) {
      if (suggestion.action !== 'Resolved') continue
      const resolverIndex = suggestion.resolverIndex
      if (
        resolverIndex === undefined
        || resolverIndex < 0
        || resolverIndex >= pullRequests.length
        || resolverIndex === dependentIndex
      ) {
        continue
      }

      let outgoing = edges.get(resolverIndex)
      if (!outgoing) {
        outgoing = new Set<number>()
        edges.set(resolverIndex, outgoing)
      }
      if (outgoing.has(dependentIndex)) continue

      outgoing.add(dependentIndex)
      indegree[dependentIndex] += 1
    }
  }

  if (edges.size === 0) return pullRequests

  const ready = indegree
    .map((value, index) => ({ value, index }))
    .filter(item => item.value === 0)
    .map(item => item.index)
  const orderedIndexes: number[] = []

  while (ready.length > 0) {
    const index = ready.shift()!
    orderedIndexes.push(index)

    for (const dependent of edges.get(index) ?? []) {
      indegree[dependent] -= 1
      if (indegree[dependent] === 0) {
        ready.push(dependent)
      }
    }
  }

  if (orderedIndexes.length !== pullRequests.length) {
    return pullRequests
  }

  return orderedIndexes.map(index => pullRequests[index])
}

export function classifyBatchDeleteRisk(
  pullRequests: Array<{ action: string; word: string | null; code: string | null }>
): { hasBareDelete: boolean; bareDeletes: Array<{ word: string; code: string }> } {
  const createsByWord = new Map<string, Set<string>>()
  for (const pr of pullRequests) {
    if (pr.action !== 'Create' || !pr.word || !pr.code) {
      continue
    }
    if (!createsByWord.has(pr.word)) {
      createsByWord.set(pr.word, new Set())
    }
    createsByWord.get(pr.word)!.add(pr.code)
  }

  const bareDeletes: Array<{ word: string; code: string }> = []
  for (const pr of pullRequests) {
    if (pr.action !== 'Delete' || !pr.word || !pr.code) {
      continue
    }
    const replacementCodes = createsByWord.get(pr.word)
    const isCodeMove = replacementCodes && Array.from(replacementCodes).some(code => code !== pr.code)
    if (!isCodeMove) {
      bareDeletes.push({ word: pr.word, code: pr.code })
    }
  }

  return { hasBareDelete: bareDeletes.length > 0, bareDeletes }
}

export async function approveSubmittedBatch({
  batchId,
  reviewNote,
  mode = 'admin',
  allowDelete = true,
}: ApproveSubmittedBatchOptions): Promise<ApproveSubmittedBatchResult> {
  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    include: {
      pullRequests: {
        include: {
          phrase: true,
        },
        orderBy: {
          createAt: 'asc',
        },
      },
    },
  })

  if (!batch) {
    throw new Error('批次不存在')
  }

  if (batch.status !== 'Submitted') {
    throw new Error('只能审核待审核状态的批次')
  }

  if (!allowDelete) {
    const deleteRisk = classifyBatchDeleteRisk(batch.pullRequests)
    if (deleteRisk.hasBareDelete) {
      const labels = deleteRisk.bareDeletes
        .slice(0, 5)
        .map(item => `「${item.word}」@${item.code}`)
        .join('、')
      throw new Error(`自动审核禁止纯删除项：${labels}`)
    }
  }

  const { checkBatchConflictsWithWeight } = await import('@/lib/services/batchConflictService')

  const prItems = batch.pullRequests.map((pr) => ({
    id: String(pr.id),
    action: pr.action as 'Create' | 'Change' | 'Delete',
    word: pr.word || '',
    oldWord: pr.oldWord || undefined,
    code: pr.code || '',
    type: pr.type || 'Phrase',
    weight: pr.weight || undefined,
  }))

  const conflictResults = await checkBatchConflictsWithWeight(prItems)

  const weightMap = new Map<number, number>()
  conflictResults.forEach(result => {
    const prId = parseInt(result.id)
    if (!isNaN(prId) && result.calculatedWeight !== undefined) {
      weightMap.set(prId, result.calculatedWeight)
    }
  })

  const executionOrder = orderPullRequestsForApproval(batch.pullRequests, conflictResults)

  const updated = await prisma.$transaction(async (tx) => {
    for (const pr of executionOrder) {
      switch (pr.action) {
        case 'Create':
          if (pr.word && pr.code) {
            const finalWeight = weightMap.get(pr.id) ?? pr.weight ?? 0

            await tx.phrase.create({
              data: {
                word: pr.word,
                code: pr.code,
                type: pr.type || 'Phrase',
                weight: finalWeight,
                remark: pr.remark,
                userId: pr.userId,
                status: 'Finish',
              },
            })
          }
          break

        case 'Change':
          if (pr.oldWord && pr.code && pr.word) {
            const oldPhrase = await tx.phrase.findFirst({
              where: {
                word: pr.oldWord,
                code: pr.code,
                type: pr.type || undefined,
              },
            })

            if (oldPhrase) {
              const finalWeight = weightMap.get(pr.id)

              await tx.phrase.update({
                where: { id: oldPhrase.id },
                data: {
                  word: pr.word,
                  type: pr.type || undefined,
                  weight: finalWeight !== undefined ? finalWeight : (pr.weight !== null ? pr.weight : undefined),
                  remark: pr.remark || undefined,
                },
              })
            }
          } else if (pr.phraseId) {
            const finalWeight = weightMap.get(pr.id)

            await tx.phrase.update({
              where: { id: pr.phraseId },
              data: {
                word: pr.word || undefined,
                type: pr.type || undefined,
                weight: finalWeight !== undefined ? finalWeight : (pr.weight !== null ? pr.weight : undefined),
                remark: pr.remark || undefined,
              },
            })
          }
          break

        case 'Delete':
          if (pr.phraseId) {
            await tx.phrase.delete({
              where: { id: pr.phraseId },
            })
          } else if (pr.word && pr.code) {
            await tx.phrase.deleteMany({
              where: {
                word: pr.word,
                code: pr.code,
                type: pr.type || undefined,
              },
            })
          }
          break
      }

      await tx.pullRequest.update({
        where: { id: pr.id },
        data: {
          status: 'Approved',
        },
      })
    }

    return tx.batch.update({
      where: { id: batchId },
      data: {
        status: 'Approved',
        reviewNote: reviewNote || (mode === 'bot-auto' ? '本喵自动审词通过' : null),
      },
    })
  })

  return { batch: updated }
}
