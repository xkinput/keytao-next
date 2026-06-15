import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireVerifiedBotUser } from '@/lib/botUserAuth'
import { checkBatchConflictsWithWeight } from '@/lib/services/batchConflictService'
import { PullRequestType } from '@prisma/client'
import { detectPhraseType, isValidPhraseType, PhraseType } from '@/lib/constants/phraseTypes'
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

const MAX_DRAFT_ITEMS = 500
const MAX_DELETE_ITEMS = 500
const MAX_WORD_LENGTH = 100
const MAX_CODE_LENGTH = 20
const MAX_REMARK_LENGTH = 500

/**
 * Bot API: Bulk add items to draft batch (tolerant mode)
 * POST /api/bot/pull-requests/batch-draft
 * Requires Bot token plus a matching user JWT or API key
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
    const body: BotBatchDraftRequest = await request.json()
    const { platform, platformId, items, batchId: requestedBatchId } = body

    if (!platform || !platformId || !items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json<BotBatchDraftResponse>(
        { success: false, message: '缺少必需参数', successCount: 0, failedCount: 0, skippedCount: 0, warnedCount: 0, failed: [], skipped: [], warned: [], draftItems: [], draftTotal: 0 },
        { status: 400 }
      )
    }

    if (items.length > MAX_DRAFT_ITEMS) {
      return NextResponse.json<BotBatchDraftResponse>(
        { success: false, message: `一次最多写入 ${MAX_DRAFT_ITEMS} 条`, successCount: 0, failedCount: 0, skippedCount: 0, warnedCount: 0, failed: [], skipped: [], warned: [], draftItems: [], draftTotal: 0 },
        { status: 400 }
      )
    }

    const auth = await requireVerifiedBotUser(platform, platformId)
    if (!auth.authorized) {
      return NextResponse.json<BotBatchDraftResponse>(
        { success: false, message: auth.message, successCount: 0, failedCount: 0, skippedCount: 0, warnedCount: 0, failed: [], skipped: [], warned: [], draftItems: [], draftTotal: 0 },
        { status: auth.status }
      )
    }
    const user = auth.user

    // Resolve or create draft batch
    let batchId = requestedBatchId
    if (batchId) {
      const batch = await prisma.batch.findUnique({
        where: { id: batchId },
        select: { id: true, creatorId: true, status: true },
      })
      if (!batch) {
        return NextResponse.json<BotBatchDraftResponse>(
          { success: false, message: '批次不存在', successCount: 0, failedCount: 0, skippedCount: 0, warnedCount: 0, failed: [], skipped: [], warned: [], draftItems: [], draftTotal: 0 },
          { status: 404 }
        )
      }
      if (batch.creatorId !== user.id) {
        return NextResponse.json<BotBatchDraftResponse>(
          { success: false, message: '无权限操作此批次', successCount: 0, failedCount: 0, skippedCount: 0, warnedCount: 0, failed: [], skipped: [], warned: [], draftItems: [], draftTotal: 0 },
          { status: 403 }
        )
      }
      if (batch.status !== 'Draft') {
        return NextResponse.json<BotBatchDraftResponse>(
          { success: false, message: '只能写入草稿状态的批次', successCount: 0, failedCount: 0, skippedCount: 0, warnedCount: 0, failed: [], skipped: [], warned: [], draftItems: [], draftTotal: 0 },
          { status: 400 }
        )
      }
    } else {
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
      select: { action: true, word: true, oldWord: true, code: true, type: true, weight: true }
    })

    // Normalize items: explicit type/weight wins, fallback to local detection/default weight.
    const normalizedItems = items.map(item => {
      if (typeof item.word !== 'string' || typeof item.code !== 'string') {
        throw new Error('词条和编码必须是字符串')
      }
      const action = (item.action ?? 'Create') as 'Create' | 'Change' | 'Delete'
      if (!['Create', 'Change', 'Delete'].includes(action)) {
        throw new Error(`不支持的操作类型：${String(item.action)}`)
      }
      const word = item.word.trim()
      const code = item.code.trim()
      if (!word || !code || word.length > MAX_WORD_LENGTH || code.length > MAX_CODE_LENGTH) {
        throw new Error(`词条必须为 1-${MAX_WORD_LENGTH} 个字符，编码必须为 1-${MAX_CODE_LENGTH} 个字符`)
      }
      const oldWord = item.oldWord?.trim()
      if (action === 'Change' && (!oldWord || oldWord.length > MAX_WORD_LENGTH)) {
        throw new Error(`修改操作的旧词必须为 1-${MAX_WORD_LENGTH} 个字符`)
      }
      if (oldWord && oldWord.length > MAX_WORD_LENGTH) {
        throw new Error(`旧词必须为 1-${MAX_WORD_LENGTH} 个字符`)
      }
      if (item.remark && item.remark.length > MAX_REMARK_LENGTH) {
        throw new Error(`备注最多 ${MAX_REMARK_LENGTH} 个字符`)
      }
      const type = normalizeType(word, code, item.type)

      return {
        action,
        word,
        code,
        oldWord,
        type,
        weight: normalizeWeight(item.weight),
        remark: item.remark,
      }
    })

    // Run conflict detection on all items at once (handles intra-batch resolution)
    const conflictItems = normalizedItems.map((item, idx) => ({
      id: String(idx),
      action: item.action,
      word: item.word,
      oldWord: item.oldWord,
      code: item.code,
      type: item.type as PhraseType,
      weight: item.weight,
    }))
    const conflictResults = await checkBatchConflictsWithWeight(conflictItems)

    const failed: BotBatchDraftFailedItem[] = []
    const skipped: BotBatchDraftFailedItem[] = []
    const warned: BotBatchDraftFailedItem[] = []
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
        pr => pr.action === item.action &&
          pr.word === item.word &&
          pr.oldWord === (item.oldWord ?? null) &&
          pr.code === item.code &&
          (pr.type ?? 'Phrase') === item.type &&
          (pr.weight ?? undefined) === item.weight
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
      const conflictReason = isResolved ? undefined : result.conflict.impact || undefined
      if (conflictReason) {
        warned.push({ index: i, word: item.word, code: item.code, reason: conflictReason })
      }
      toWrite.push({ item, conflictReason })
      // Mark this as "now in draft" so subsequent items in same request see it
      existingPRs.push({ action: item.action, word: item.word, oldWord: item.oldWord ?? null, code: item.code, type: item.type, weight: item.weight ?? null })
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
              weight: item.weight,
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
          select: { id: true, action: true, word: true, code: true, type: true, weight: true, status: true, conflictReason: true },
        },
      },
    })

    const draftItems: BotDraftSnapshotItem[] = (updatedBatch?.pullRequests ?? []).map(pr => ({
      id: pr.id,
      action: pr.action,
      word: pr.word ?? '',
      code: pr.code ?? '',
      type: pr.type ?? 'Phrase',
      weight: pr.weight,
      status: pr.status,
      ...(pr.conflictReason && { hasWarning: true, warningNote: pr.conflictReason }),
    }))

    const successCount = toWrite.length
    const failedCount = failed.length
    const skippedCount = skipped.length
    const warnedCount = warned.length

    const parts: string[] = [`成功写入 ${successCount} 条`]
    if (failedCount > 0) parts.push(`冲突 ${failedCount} 条`)
    if (skippedCount > 0) parts.push(`跳过重复 ${skippedCount} 条`)
    if (warnedCount > 0) parts.push(`重码警告 ${warnedCount} 条`)

    return NextResponse.json<BotBatchDraftResponse>({
      success: true,
      message: parts.join('，'),
      batchId: batchId!,
      successCount,
      failedCount,
      skippedCount,
      warnedCount,
      failed,
      skipped,
      warned,
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
        warnedCount: 0,
        failed: [],
        skipped: [],
        warned: [],
        draftItems: [],
        draftTotal: 0,
      },
      { status: 500 }
    )
  }
}

function normalizeType(word: string, code: string, explicit?: string): PhraseType {
  if (explicit) {
    if (!isValidPhraseType(explicit)) {
      throw new Error(`不支持的词库类型：${explicit}`)
    }
    return explicit
  }

  return detectPhraseType(word, code)
}

function normalizeWeight(weight: unknown): number | undefined {
  if (weight === undefined || weight === null || weight === '') return undefined
  const parsed = typeof weight === 'number' ? weight : Number(weight)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`权重必须是非负整数：${String(weight)}`)
  }
  return parsed
}

/**
 * Bot API: Batch delete items from draft batch
 * DELETE /api/bot/pull-requests/batch-draft
 * Requires Bot token plus a matching user JWT or API key
 *
 * Body: { platform, platformId, ids: number[] }
 * Only deletes items that belong to the caller and are in Draft status.
 */
export async function DELETE(request: NextRequest) {
  try {
    const body: BotBatchDeleteDraftRequest = await request.json()
    const { platform, platformId, ids } = body

    if (!platform || !platformId || !ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json<BotBatchDeleteDraftResponse>(
        { success: false, message: '缺少必需参数', successCount: 0, failedCount: 0, deleted: [], failed: [], draftItems: [], draftTotal: 0 },
        { status: 400 }
      )
    }

    if (ids.length > MAX_DELETE_ITEMS || ids.some(id => !Number.isInteger(id) || id <= 0)) {
      return NextResponse.json<BotBatchDeleteDraftResponse>(
        { success: false, message: `一次最多删除 ${MAX_DELETE_ITEMS} 条，且 ID 必须为正整数`, successCount: 0, failedCount: 0, deleted: [], failed: [], draftItems: [], draftTotal: 0 },
        { status: 400 }
      )
    }

    const auth = await requireVerifiedBotUser(platform, platformId)
    if (!auth.authorized) {
      return NextResponse.json<BotBatchDeleteDraftResponse>(
        { success: false, message: auth.message, successCount: 0, failedCount: 0, deleted: [], failed: [], draftItems: [], draftTotal: 0 },
        { status: auth.status }
      )
    }
    const user = auth.user

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
            select: { id: true, action: true, word: true, code: true, type: true, weight: true, status: true },
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
      weight: pr.weight,
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
