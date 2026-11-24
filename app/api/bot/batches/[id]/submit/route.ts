import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireVerifiedBotUser } from '@/lib/botUserAuth'
import { checkBatchConflictsWithWeight } from '@/lib/services/batchConflictService'
import { classifyBatchDeleteRisk } from '@/lib/services/batchApprovalService'
import { ItemReviewError } from '@/lib/services/batchItemReview'
import { buildBatchSubmitWarnings } from '@/lib/services/batchSubmitWarnings'
import { buildSkippedCandidateSlotWarnings } from '@/lib/services/batchSkippedCodeWarnings'
import { buildPriorityOrderWarnings } from '@/lib/services/batchPriorityOrderWarnings'
import { PhraseType } from '@/lib/constants/phraseTypes'
import {
  buildBotWarningDigest,
  createCanonicalDigest,
  lockPhraseTableForWarningSnapshot,
} from '@/lib/services/botWarningSnapshot'

export const maxDuration = 30

function getErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '未知错误'
}

/**
 * Bot API: Submit batch for review
 * POST /api/bot/batches/:id/submit
 * Requires a valid Bot token and a bound platform user
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const rawBody = await request.clone().text()
    const body: unknown = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ success: false, message: '请求格式错误' }, { status: 400 })
    }

    const allowedKeys = new Set([
      'platform', 'platformId', 'confirmed', 'expectedContentVersion', 'previewOnly',
      'expectedWarningDigest',
      'expectedSnapshotDigest',
      'approvedItemIds',
    ])
    if (Object.keys(body).some(key => !allowedKeys.has(key))) {
      return NextResponse.json({ success: false, message: '请求包含不支持的字段' }, { status: 400 })
    }

    const payload = body as Record<string, unknown>
    const { platform, platformId } = payload
    const confirmed = payload.confirmed ?? false
    const previewOnly = payload.previewOnly ?? false
    const expectedContentVersion = payload.expectedContentVersion
    const expectedWarningDigest = payload.expectedWarningDigest
    const expectedSnapshotDigest = payload.expectedSnapshotDigest
    const proposedApprovals = payload.approvedItemIds === undefined ? [] : payload.approvedItemIds
    if (
      typeof platform !== 'string'
      || typeof platformId !== 'string'
      || typeof confirmed !== 'boolean'
      || typeof previewOnly !== 'boolean'
      || !Number.isInteger(expectedContentVersion)
      || (expectedContentVersion as number) < 0
    ) {
      return NextResponse.json(
        { success: false, message: 'platform、platformId、confirmed 或 expectedContentVersion 类型错误' },
        { status: 400 }
      )
    }
    if (
      !Array.isArray(proposedApprovals)
      || !proposedApprovals.every(id => Number.isInteger(id) && id > 0 && id <= 2147483647)
      || new Set(proposedApprovals).size !== proposedApprovals.length
    ) {
      return NextResponse.json({ success: false, message: 'approvedItemIds 必须是无重复的词条 ID 列表' }, { status: 400 })
    }
    const approvedItemIds: number[] = [...proposedApprovals].sort((a, b) => a - b)
    const approvalIds = new Set(approvedItemIds)
    if (confirmed && previewOnly) {
      return NextResponse.json(
        { success: false, message: 'confirmed 与 previewOnly 不能同时为 true' },
        { status: 400 }
      )
    }
    if (
      confirmed
      && (
        typeof expectedWarningDigest !== 'string'
        || !/^[a-f0-9]{64}$/.test(expectedWarningDigest)
        || typeof expectedSnapshotDigest !== 'string'
        || !/^[a-f0-9]{64}$/.test(expectedSnapshotDigest)
      )
    ) {
      return NextResponse.json(
        { success: false, message: '确认提交必须包含 expectedWarningDigest' },
        { status: 400 }
      )
    }

    const auth = await requireVerifiedBotUser(platform, platformId, { request, rawBody })
    if (!auth.authorized) {
      return NextResponse.json(
        { success: false, message: auth.message },
        { status: auth.status }
      )
    }
    const user = auth.user

    // Get batch
    const batch = await prisma.batch.findUnique({
      where: { id },
      include: {
        pullRequests: {
          orderBy: {
            createAt: 'asc'
          }
        }
      }
    })

    if (!batch) {
      return NextResponse.json(
        { success: false, message: '批次不存在' },
        { status: 404 }
      )
    }

    // Check ownership
    if (batch.creatorId !== user.id) {
      return NextResponse.json(
        { success: false, message: '无权限操作此批次' },
        { status: 403 }
      )
    }

    // Check status
    if (batch.status !== 'Draft' && batch.status !== 'Rejected') {
      return NextResponse.json(
        { success: false, message: '只能提交草稿或已拒绝状态的批次' },
        { status: 400 }
      )
    }
    if (batch.itemReviewStarted) {
      return NextResponse.json({ success: false, message: '请在网页重新送审被拒绝的词条' }, { status: 409 })
    }

    if (batch.contentVersion !== expectedContentVersion) {
      return NextResponse.json(
        { success: false, message: '批次内容已被修改，请刷新后重试' },
        { status: 409 }
      )
    }

    // Check if batch has PRs
    if (batch.pullRequests.length === 0) {
      return NextResponse.json(
        { success: false, message: '批次中没有修改提议' },
        { status: 400 }
      )
    }
    const approvedItems = batch.pullRequests.filter(pr => approvalIds.has(pr.id))
    if (
      approvedItems.length !== approvedItemIds.length
      || approvedItems.some(pr => !pr.word || !pr.code || pr.needsManualReview || pr.appliedAt
        || (pr.status !== 'Pending' && !(batch.status === 'Rejected' && pr.status === 'Rejected')))
      || classifyBatchDeleteRisk(approvedItems).hasBareDelete
    ) {
      return NextResponse.json({ success: false, message: '指定自动通过的词条不属于此批次或需要人工审核' }, { status: 409 })
    }

    // Validate batch for conflicts
    const items = batch.pullRequests.map((pr) => ({
      id: pr.id.toString(),
      action: pr.action as 'Create' | 'Change' | 'Delete',
      word: pr.word || '',
      oldWord: pr.oldWord || undefined,
      code: pr.code || '',
      type: (pr.type || 'Phrase') as PhraseType,
      weight: pr.weight || undefined
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
      return NextResponse.json(
        {
          success: false,
          message: '批次中存在未解决的冲突，无法提交',
          conflicts: unresolvedConflicts
        },
        { status: 400 }
      )
    }

    const warnings = [
      ...buildBatchSubmitWarnings(items, results),
      ...await buildSkippedCandidateSlotWarnings(items),
      ...await buildPriorityOrderWarnings(items),
    ]
    const warningState = { results, warnings }
    const warningDigest = await buildBotWarningDigest(prisma, items, warningState)
    const snapshotDigest = createCanonicalDigest({
      batchId: batch.id,
      contentVersion: batch.contentVersion,
      pullRequests: batch.pullRequests,
      warnings,
      warningDigest,
      ...(approvedItemIds.length ? { approvedItemIds } : {}),
    })

    if (previewOnly || !confirmed) {
      return NextResponse.json(
        {
          success: false,
          warnings,
          requiresConfirmation: true,
          batchId: batch.id,
          contentVersion: batch.contentVersion,
          warningDigest,
          snapshotDigest,
          approvedItemIds,
          message: warnings.length > 0
            ? `批次中存在 ${warnings.length} 个警告，确认后可继续提交`
            : '批次检查完成，请确认后提交',
        },
        { status: 400 }
      )
    }

    if (warningDigest !== expectedWarningDigest) {
      return NextResponse.json(
        { success: false, message: '警告快照已变化，请重新确认' },
        { status: 409 }
      )
    }
    if (snapshotDigest !== expectedSnapshotDigest) {
      return NextResponse.json(
        { success: false, message: '批次提交快照已变化，请重新确认' },
        { status: 409 }
      )
    }

    // Update batch status to Submitted
    const transitioned = await prisma.$transaction(async (tx) => {
      await lockPhraseTableForWarningSnapshot(tx)
      const lockedDigest = await buildBotWarningDigest(tx, items, warningState)
      if (lockedDigest !== expectedWarningDigest) return { count: 0 }
      const lockedPullRequests = await tx.pullRequest.findMany({
        where: { batchId: id },
        orderBy: { createAt: 'asc' },
      })
      const lockedSnapshotDigest = createCanonicalDigest({
        batchId: batch.id,
        contentVersion: batch.contentVersion,
        pullRequests: lockedPullRequests,
        warnings,
        warningDigest: lockedDigest,
        ...(approvedItemIds.length ? { approvedItemIds } : {}),
      })
      if (lockedSnapshotDigest !== expectedSnapshotDigest) return { count: 0 }
      const result = await tx.batch.updateMany({
        where: {
          id,
          creatorId: user.id,
          status: { in: ['Draft', 'Rejected'] },
          itemReviewStarted: false,
          contentVersion: expectedContentVersion as number,
        },
        data: {
          status: 'Submitted',
          reviewNote: null,
          contentVersion: { increment: 1 },
          ...(approvedItemIds.length ? { itemReviewStarted: true } : {}),
        },
      })
      if (result.count === 1 && batch.status === 'Rejected') {
        await tx.pullRequest.updateMany({ where: { batchId: id, status: 'Rejected' }, data: { status: 'Pending' } })
      }
      if (result.count === 1 && approvedItemIds.length) {
        const approved = await tx.pullRequest.updateMany({
          where: {
            batchId: id,
            id: { in: approvedItemIds },
            status: 'Pending',
            appliedAt: null,
            needsManualReview: false,
          },
          data: { status: 'Approved' },
        })
        if (approved.count !== approvedItemIds.length) {
          throw new ItemReviewError('自动审核的词条已变化，请重新确认', 409)
        }
        await tx.pullRequestReviewNote.createMany({
          data: approvedItemIds.map(pullRequestId => ({
            pullRequestId,
            decision: 'Approved',
            reason: '本喵根据逐条审核记录标记通过',
          })),
        })
      }
      return result
    })

    if (transitioned.count !== 1) {
      return NextResponse.json(
        { success: false, message: '批次内容或状态已被其他操作修改，请刷新后重试' },
        { status: 409 }
      )
    }

    return NextResponse.json({
      success: true,
      message: '批次已提交审核',
      approvedItemIds,
      batch: {
        id,
        status: 'Submitted',
        contentVersion: (expectedContentVersion as number) + 1,
      }
    })
  } catch (error: unknown) {
    if (error instanceof ItemReviewError) {
      return NextResponse.json({ success: false, message: error.message }, { status: error.status })
    }
    console.error('[Bot API] Submit error:', error)

    // Handle specific error types
    const errorCode = getErrorCode(error)
    if (errorCode === 'P2022') {
      return NextResponse.json(
        { success: false, message: '数据库配置错误，请联系管理员检查数据库迁移状态' },
        { status: 500 }
      )
    }

    if (errorCode === 'P2025') {
      return NextResponse.json(
        { success: false, message: '批次或用户不存在' },
        { status: 404 }
      )
    }

    return NextResponse.json(
      { success: false, message: `提交失败：${getErrorMessage(error)}` },
      { status: 500 }
    )
  }
}
