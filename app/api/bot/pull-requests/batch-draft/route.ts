import { NextRequest, NextResponse } from 'next/server'
import { verifyBotToken } from '@/lib/botAuth'
import { prisma } from '@/lib/prisma'
import { checkBatchConflictsWithWeight } from '@/lib/services/batchConflictService'
import { PullRequestType } from '@prisma/client'
import { PhraseType } from '@/lib/constants/phraseTypes'
import type {
  BotBatchDraftRequest,
  BotBatchDraftResponse,
  BotBatchDraftFailedItem,
  BotDraftSnapshotItem,
  BotBatchDeleteDraftRequest,
  BotBatchDeleteDraftResponse,
  BotBatchDeleteDraftDeletedItem,
  BotBatchDeleteDraftFailedItem,
} from '@/lib/types/bot'

/**
 * Bot API: Bulk add items to draft batch (tolerant mode)
 * POST /api/bot/pull-requests/batch-draft
 *
 * Unlike the regular batch endpoint, this one:
 * - Processes each item individually
 * - Hard conflicts (duplicate word+code, missing existing phrase) → skip, report in `failed`
 * - Duplicate-in-draft → skip silently, report in `skipped`
 * - Warnings (重码) → auto-confirm and write to draft
 * - Returns success count, failed list, and current draft snapshot
 */
export async function POST(request: NextRequest) {
  try {
    if (!await verifyBotToken()) {
      return NextResponse.json<BotBatchDraftResponse>(
        { success: false, message: '未授权', successCount: 0, failedCount: 0, skippedCount: 0, failed: [], skipped: [], draftItems: [], draftTotal: 0 },
        { status: 401 }
      )
    }

    const body: BotBatchDraftRequest = await request.json()
    const { platform, platformId, items, batchId: requestedBatchId } = body

    if (!platform || !platformId || !items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json<BotBatchDraftResponse>(
        { success: false, message: '缺少必需参数', successCount: 0, failedCount: 0, skippedCount: 0, failed: [], skipped: [], draftItems: [], draftTotal: 0 },
        { status: 400 }
      )
    }

    if (!['qq', 'telegram'].includes(platform)) {
      return NextResponse.json<BotBatchDraftResponse>(
        { success: false, message: '不支持的平台', successCount: 0, failedCount: 0, skippedCount: 0, failed: [], skipped: [], draftItems: [], draftTotal: 0 },
        { status: 400 }
      )
    }

    // Resolve user
    const fieldName = platform === 'qq' ? 'qqId' : 'telegramId'
    const user = await prisma.user.findFirst({
      where: { [fieldName]: platformId, status: 'ENABLE' },
      select: { id: true }
    })

    if (!user) {
      return NextResponse.json<BotBatchDraftResponse>(
        { success: false, message: '未找到绑定账号，请先使用 /bind 命令绑定', successCount: 0, failedCount: 0, skippedCount: 0, failed: [], skipped: [], draftItems: [], draftTotal: 0 },
        { status: 404 }
      )
    }

    // Resolve or create draft batch
    let batchId = requestedBatchId
    if (!batchId) {
      let batch = await prisma.batch.findFirst({
        where: { creatorId: user.id, status: 'Draft', description: { startsWith: '键道助手' } },
        orderBy: { createAt: 'desc' },
        select: { id: true }
      })
      if (!batch) {
        batch = await prisma.batch.create({
          data: { description: '键道助手草稿批次', creatorId: user.id, status: 'Draft' },
          select: { id: true }
        })
      }
      batchId = batch.id
    }

    // Load existing draft items (for duplicate detection)
    const existingPRs = await prisma.pullRequest.findMany({
      where: { batchId },
      select: { action: true, word: true, code: true }
    })

    // Normalize items: infer type if not given
    const normalizedItems = items.map(item => ({
      action: (item.action ?? 'Create') as 'Create' | 'Change' | 'Delete',
      word: item.word.trim(),
      code: item.code.trim(),
      oldWord: item.oldWord,
      type: inferType(item.word.trim(), item.code.trim(), item.type),
      remark: item.remark,
    }))

    // Run conflict detection on all items at once (handles intra-batch resolution)
    const conflictItems = normalizedItems.map((item, idx) => ({
      id: String(idx),
      action: item.action,
      word: item.word,
      oldWord: item.oldWord,
      code: item.code,
      type: item.type as PhraseType,
    }))
    const conflictResults = await checkBatchConflictsWithWeight(conflictItems)

    const failed: BotBatchDraftFailedItem[] = []
    const skipped: BotBatchDraftFailedItem[] = []
    const toWrite: Array<{ item: typeof normalizedItems[0]; conflictReason?: string }> = []

    for (let i = 0; i < normalizedItems.length; i++) {
      const item = normalizedItems[i]
      const result = conflictResults[i]

      // Hard conflict → reject
      if (result.conflict.hasConflict) {
        failed.push({
          index: i,
          word: item.word,
          code: item.code,
          reason: result.conflict.impact || '冲突',
        })
        continue
      }

      // Duplicate in existing draft → skip
      const isDuplicate = existingPRs.some(
        pr => pr.action === item.action && pr.word === item.word && pr.code === item.code
      )
      if (isDuplicate) {
        skipped.push({
          index: i,
          word: item.word,
          code: item.code,
          reason: '草稿中已存在相同条目',
        })
        continue
      }

      // Warning (重码) or clean → write (warnings auto-confirmed for bulk operations)
      const isResolved = result.conflict.suggestions?.some(s => s.action === 'Resolved')
      toWrite.push({ item, conflictReason: isResolved ? undefined : result.conflict.impact || undefined })
      // Mark this as "now in draft" so subsequent items in same request see it
      existingPRs.push({ action: item.action, word: item.word, code: item.code })
    }

    // Write all accepted items in one transaction
    if (toWrite.length > 0) {
      await prisma.$transaction(
        toWrite.map(({ item, conflictReason }) =>
          prisma.pullRequest.create({
            data: {
              word: item.word,
              oldWord: item.oldWord ?? undefined,
              code: item.code,
              action: item.action as PullRequestType,
              type: item.type as PhraseType,
              remark: item.remark ?? null,
              userId: user.id,
              batchId: batchId!,
              hasConflict: false,
              conflictReason: conflictReason ?? null,
            },
          })
        )
      )
    }

    // Fetch updated draft snapshot
    const updatedBatch = await prisma.batch.findUnique({
      where: { id: batchId! },
      select: {
        pullRequests: {
          orderBy: { createAt: 'asc' },
          select: { id: true, action: true, word: true, code: true, type: true, status: true },
        },
      },
    })

    const draftItems: BotDraftSnapshotItem[] = (updatedBatch?.pullRequests ?? []).map(pr => ({
      id: pr.id,
      action: pr.action,
      word: pr.word ?? '',
      code: pr.code ?? '',
      type: pr.type ?? 'Phrase',
      status: pr.status,
    }))

    const successCount = toWrite.length
    const failedCount = failed.length
    const skippedCount = skipped.length

    const parts: string[] = [`成功写入 ${successCount} 条`]
    if (failedCount > 0) parts.push(`冲突 ${failedCount} 条`)
    if (skippedCount > 0) parts.push(`跳过重复 ${skippedCount} 条`)

    return NextResponse.json<BotBatchDraftResponse>({
      success: true,
      message: parts.join('，'),
      batchId: batchId!,
      successCount,
      failedCount,
      skippedCount,
      failed,
      skipped,
      draftItems,
      draftTotal: draftItems.length,
    })
  } catch (error: unknown) {
    console.error('[Bot API] batch-draft error:', error)
    const msg = error instanceof Error ? error.message : '未知错误'
    return NextResponse.json<BotBatchDraftResponse>(
      {
        success: false,
        message: `批量写入失败：${msg}`,
        successCount: 0,
        failedCount: 0,
        skippedCount: 0,
        failed: [],
        skipped: [],
        draftItems: [],
        draftTotal: 0,
      },
      { status: 500 }
    )
  }
}

function inferType(word: string, code: string, explicit?: string): PhraseType {
  if (explicit && explicit !== 'Phrase') return explicit as PhraseType
  if (code.startsWith(';')) return 'Symbol'
  if (/https?:\/\/|www\./i.test(word)) return 'Link'
  if (/[a-zA-Z]/.test(word)) return 'English'
  if (word.length === 1 && /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(word)) return 'Single'
  return 'Phrase'
}

/**
 * Bot API: Batch delete items from draft batch
 * DELETE /api/bot/pull-requests/batch-draft
 *
 * Body: { platform, platformId, ids: number[] }
 * Only deletes items that belong to the caller and are in Draft status.
 */
export async function DELETE(request: NextRequest) {
  try {
    if (!await verifyBotToken()) {
      return NextResponse.json<BotBatchDeleteDraftResponse>(
        { success: false, message: '未授权', successCount: 0, failedCount: 0, deleted: [], failed: [], draftItems: [], draftTotal: 0 },
        { status: 401 }
      )
    }

    const body: BotBatchDeleteDraftRequest = await request.json()
    const { platform, platformId, ids } = body

    if (!platform || !platformId || !ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json<BotBatchDeleteDraftResponse>(
        { success: false, message: '缺少必需参数', successCount: 0, failedCount: 0, deleted: [], failed: [], draftItems: [], draftTotal: 0 },
        { status: 400 }
      )
    }

    if (!['qq', 'telegram'].includes(platform)) {
      return NextResponse.json<BotBatchDeleteDraftResponse>(
        { success: false, message: '不支持的平台', successCount: 0, failedCount: 0, deleted: [], failed: [], draftItems: [], draftTotal: 0 },
        { status: 400 }
      )
    }

    const fieldName = platform === 'qq' ? 'qqId' : 'telegramId'
    const user = await prisma.user.findFirst({
      where: { [fieldName]: platformId, status: 'ENABLE' },
      select: { id: true }
    })

    if (!user) {
      return NextResponse.json<BotBatchDeleteDraftResponse>(
        { success: false, message: '未找到绑定账号，请先使用 /bind 命令绑定', successCount: 0, failedCount: 0, deleted: [], failed: [], draftItems: [], draftTotal: 0 },
        { status: 404 }
      )
    }

    // Fetch all requested PRs with batch info
    const prs = await prisma.pullRequest.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        action: true,
        word: true,
        code: true,
        userId: true,
        batchId: true,
        batch: { select: { id: true, status: true } },
      },
    })

    const prMap = new Map(prs.map(pr => [pr.id, pr]))
    const deleted: BotBatchDeleteDraftDeletedItem[] = []
    const failed: BotBatchDeleteDraftFailedItem[] = []
    const toDeleteIds: number[] = []
    let batchId: string | undefined

    for (const id of ids) {
      const pr = prMap.get(id)
      if (!pr) {
        failed.push({ id, reason: '条目不存在' })
        continue
      }
      if (pr.userId !== user.id) {
        failed.push({ id, reason: '无权限删除此条目' })
        continue
      }
      if (pr.batch?.status !== 'Draft') {
        failed.push({ id, reason: '只能删除草稿状态的条目' })
        continue
      }
      toDeleteIds.push(id)
      deleted.push({ id, word: pr.word ?? '', code: pr.code ?? '', action: pr.action })
      batchId = batchId ?? (pr.batchId ?? undefined)
    }

    if (toDeleteIds.length > 0) {
      await prisma.pullRequest.deleteMany({ where: { id: { in: toDeleteIds } } })
    }

    // Fetch updated draft snapshot
    const updatedBatch = batchId
      ? await prisma.batch.findUnique({
        where: { id: batchId },
        select: {
          pullRequests: {
            orderBy: { createAt: 'asc' },
            select: { id: true, action: true, word: true, code: true, type: true, status: true },
          },
        },
      })
      : null

    const draftItems: BotDraftSnapshotItem[] = (updatedBatch?.pullRequests ?? []).map(pr => ({
      id: pr.id,
      action: pr.action,
      word: pr.word ?? '',
      code: pr.code ?? '',
      type: pr.type ?? 'Phrase',
      status: pr.status,
    }))

    const parts: string[] = [`成功删除 ${deleted.length} 条`]
    if (failed.length > 0) parts.push(`失败 ${failed.length} 条`)

    return NextResponse.json<BotBatchDeleteDraftResponse>({
      success: true,
      message: parts.join('，'),
      ...(batchId && { batchId }),
      successCount: deleted.length,
      failedCount: failed.length,
      deleted,
      failed,
      draftItems,
      draftTotal: draftItems.length,
    })
  } catch (error: unknown) {
    console.error('[Bot API] batch-draft DELETE error:', error)
    const msg = error instanceof Error ? error.message : '未知错误'
    return NextResponse.json<BotBatchDeleteDraftResponse>(
      { success: false, message: `批量删除失败：${msg}`, successCount: 0, failedCount: 0, deleted: [], failed: [], draftItems: [], draftTotal: 0 },
      { status: 500 }
    )
  }
}
