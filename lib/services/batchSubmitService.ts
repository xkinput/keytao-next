import { prisma } from '@/lib/prisma'
import { checkBatchConflictsWithWeight } from '@/lib/services/batchConflictService'
import { buildBatchSubmitWarnings } from '@/lib/services/batchSubmitWarnings'
import { buildSkippedCandidateSlotWarnings } from '@/lib/services/batchSkippedCodeWarnings'
import { buildPriorityOrderWarnings } from '@/lib/services/batchPriorityOrderWarnings'
import { PhraseType } from '@/lib/constants/phraseTypes'
import {
  buildBotWarningDigest,
  lockPhraseTableForWarningSnapshot,
} from '@/lib/services/botWarningSnapshot'

export interface SubmitBatchInput {
  batchId: string
  userId: number
  rawBody: unknown
}

export interface SubmitBatchResult {
  status: number
  body: Record<string, unknown>
}

export async function submitBatchForUser({
  batchId,
  userId,
  rawBody,
}: SubmitBatchInput): Promise<SubmitBatchResult> {
  if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
    return { status: 400, body: { error: '请求格式错误' } }
  }

  const body = rawBody as {
    confirmed?: unknown
    expectedContentVersion?: unknown
    expectedWarningDigest?: unknown
  }
  const confirmed = body.confirmed === true
  if (body.confirmed !== undefined && typeof body.confirmed !== 'boolean') {
    return { status: 400, body: { error: 'confirmed 类型错误' } }
  }
  if (
    body.expectedContentVersion !== undefined
    && (!Number.isInteger(body.expectedContentVersion) || (body.expectedContentVersion as number) < 0)
  ) {
    return { status: 400, body: { error: 'expectedContentVersion 类型错误' } }
  }
  if (confirmed && body.expectedContentVersion === undefined) {
    return { status: 400, body: { error: '确认提交必须包含 expectedContentVersion' } }
  }
  if (
    confirmed
    && (typeof body.expectedWarningDigest !== 'string' || !/^[a-f0-9]{64}$/.test(body.expectedWarningDigest))
  ) {
    return { status: 400, body: { error: '确认提交必须包含 expectedWarningDigest' } }
  }

  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    include: {
      pullRequests: {
        orderBy: {
          createAt: 'asc',
        },
      },
    },
  })

  if (!batch) {
    return { status: 404, body: { error: '批次不存在' } }
  }

  if (batch.creatorId !== userId) {
    return { status: 403, body: { error: '无权限' } }
  }

  if (batch.status !== 'Draft' && batch.status !== 'Rejected') {
    return { status: 400, body: { error: '只能提交草稿或已拒绝状态的批次' } }
  }

  const expectedContentVersion = body.expectedContentVersion === undefined
    ? batch.contentVersion
    : body.expectedContentVersion as number
  if (batch.contentVersion !== expectedContentVersion) {
    return { status: 409, body: { error: '批次内容已被修改，请刷新后重试' } }
  }

  if (batch.pullRequests.length === 0) {
    return { status: 400, body: { error: '批次中没有修改提议' } }
  }

  // Validate batch for conflicts using the same logic as check-conflicts-batch
  const items = batch.pullRequests.map((pr) => ({
    id: pr.id.toString(),
    action: pr.action as 'Create' | 'Change' | 'Delete',
    word: pr.word || '',
    oldWord: pr.oldWord || undefined,
    code: pr.code || '',
    type: (pr.type || 'Phrase') as PhraseType,
    weight: pr.weight || undefined,
  }))

  const results = await checkBatchConflictsWithWeight(items)

  // Check for unresolved conflicts
  const unresolvedConflicts = results
    .filter(result => {
      const isResolved = result.conflict.suggestions?.some(sug => sug.action === 'Resolved')
      return result.conflict.hasConflict && !isResolved
    })
    .map(result => result.conflict)

  if (unresolvedConflicts.length > 0) {
    return {
      status: 400,
      body: {
        error: '批次中存在未解决的冲突',
        conflicts: unresolvedConflicts,
      },
    }
  }

  const warnings = [
    ...buildBatchSubmitWarnings(items, results),
    ...await buildSkippedCandidateSlotWarnings(items),
    ...await buildPriorityOrderWarnings(items),
  ]
  const warningState = { results, warnings }
  const warningDigest = await buildBotWarningDigest(prisma, items, warningState)

  if (!confirmed) {
    if (warnings.length > 0) {
      return {
        status: 400,
        body: {
          error: `批次中存在 ${warnings.length} 个重码/多编码/跳过编码空位/同码链优先级警告，确认后可继续提交`,
          warnings,
          requiresConfirmation: true,
          batchId: batch.id,
          contentVersion: batch.contentVersion,
          warningDigest,
        },
      }
    }
  }

  if (confirmed && warningDigest !== body.expectedWarningDigest) {
    return { status: 409, body: { error: '警告快照已变化，请重新确认' } }
  }

  // Update batch status
  const transition = () => prisma.batch.updateMany({
    where: {
      id: batchId,
      creatorId: userId,
      status: { in: ['Draft', 'Rejected'] },
      contentVersion: expectedContentVersion,
    },
    data: {
      status: 'Submitted',
      reviewNote: null, // Clear previous rejection note
      contentVersion: { increment: 1 },
    },
  })
  const transitioned = confirmed
    ? await prisma.$transaction(async (tx) => {
      await lockPhraseTableForWarningSnapshot(tx)
      const lockedDigest = await buildBotWarningDigest(tx, items, warningState)
      if (lockedDigest !== body.expectedWarningDigest) return { count: 0 }
      return tx.batch.updateMany({
        where: {
          id: batchId,
          creatorId: userId,
          status: { in: ['Draft', 'Rejected'] },
          contentVersion: expectedContentVersion,
        },
        data: {
          status: 'Submitted',
          reviewNote: null,
          contentVersion: { increment: 1 },
        },
      })
    })
    : await transition()

  if (transitioned.count !== 1) {
    return { status: 409, body: { error: '批次内容或状态已被其他操作修改，请刷新后重试' } }
  }

  return {
    status: 200,
    body: {
      batch: { id: batchId, status: 'Submitted', contentVersion: expectedContentVersion + 1 },
    },
  }
}
