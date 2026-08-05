import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireVerifiedBotUser } from '@/lib/botUserAuth'
import { checkBatchConflictsWithWeight } from '@/lib/services/batchConflictService'
import { buildSkippedCandidateSlotWarnings } from '@/lib/services/batchSkippedCodeWarnings'
import { PullRequestType } from '@prisma/client'
import { detectPhraseType, isValidPhraseType, PhraseType } from '@/lib/constants/phraseTypes'
import { assertNoBotDraftBatch, assertNoOtherBotDraftWithContent, BatchContentLockedError, claimBatchContentMutation, lockBotDraftUser } from '@/lib/services/batchContentGuard'
import { BOT_DRAFT_BATCH_DESCRIPTION, findCurrentBotDraftBatch, NEW_BOT_DRAFT_BATCH_IDENTITY } from '@/lib/services/botDraftBatch'
import {
  assertExpectedBatchTargets,
  BatchTargetChangedError,
  parseExpectedBatchTargets,
} from '@/lib/services/batchDeleteTargets'
import {
  buildBotWarningDigest,
  lockPhraseTableForWarningSnapshot,
} from '@/lib/services/botWarningSnapshot'
import { createPhraseTargetFingerprint } from '@/lib/services/phraseTargetBinding'
import { randomUUID } from 'crypto'
import { containsMiaomiaoReviewBlockDelimiter } from '@/lib/validation/phraseInput'
import type {
  BotBatchDraftRequest,
  BotBatchDraftResponse,
  BotBatchDraftFailedItem,
  BotDraftSnapshotItem,
  BotBatchDeleteDraftResponse,
  BotBatchDeleteDraftDeletedItem,
} from '@/lib/types/bot'

const MAX_DRAFT_ITEMS = 500
const MAX_DELETE_ITEMS = 500
const MAX_WORD_LENGTH = 100
const MAX_CODE_LENGTH = 20
const MAX_REMARK_LENGTH = 500

/**
 * Bot API: Bulk add items to draft batch (tolerant mode)
 * POST /api/bot/pull-requests/batch-draft
 * Requires a valid Bot token and a bound platform user
 *
 * Unlike the regular batch endpoint, this one:
 * - Processes each item individually
 * - Hard conflicts (duplicate word+code, missing existing phrase) → skip, report in `failed`
 * - Duplicate-in-draft → skip silently, report in `skipped`
 * - Every first request returns a server-bound preview ticket without writing
 * - Returns success count, failed list, and current draft snapshot
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.clone().text()
    const body: BotBatchDraftRequest = await request.json()
    const {
      platform,
      platformId,
      items,
      batchId: requestedBatchId,
      confirmed = false,
      expectedContentVersion,
      expectedWarningDigest,
      previewOnly = false,
    } = body

    const auth = await requireVerifiedBotUser(platform, platformId, { request, rawBody })
    if (!auth.authorized) {
      return NextResponse.json<BotBatchDraftResponse>(
        { success: false, message: auth.message, successCount: 0, failedCount: 0, skippedCount: 0, warnedCount: 0, failed: [], skipped: [], warned: [], draftItems: [], draftTotal: 0 },
        { status: auth.status }
      )
    }
    const user = auth.user

    if (typeof confirmed !== 'boolean') {
      return NextResponse.json<BotBatchDraftResponse>(
        { success: false, message: 'confirmed 类型错误', successCount: 0, failedCount: 0, skippedCount: 0, warnedCount: 0, failed: [], skipped: [], warned: [], draftItems: [], draftTotal: 0 },
        { status: 400 }
      )
    }
    if (typeof previewOnly !== 'boolean' || (previewOnly && confirmed)) {
      return NextResponse.json<BotBatchDraftResponse>(
        { success: false, message: 'previewOnly 类型错误，且不能与 confirmed 同时为 true', successCount: 0, failedCount: 0, skippedCount: 0, warnedCount: 0, failed: [], skipped: [], warned: [], draftItems: [], draftTotal: 0 },
        { status: 400 }
      )
    }

    if (
      expectedContentVersion !== undefined
      && (!Number.isInteger(expectedContentVersion) || expectedContentVersion < 0)
    ) {
      return NextResponse.json<BotBatchDraftResponse>(
        { success: false, message: 'expectedContentVersion 类型错误', successCount: 0, failedCount: 0, skippedCount: 0, warnedCount: 0, failed: [], skipped: [], warned: [], draftItems: [], draftTotal: 0 },
        { status: 400 }
      )
    }
    // `expectedContentVersion: 0` without a batchId is the "this user has no
    // draft batch yet" CAS baseline: the write may create the first draft, but
    // only while that is still true (re-checked under the write lock). Any
    // other version needs an explicit batch to compare against.
    if (expectedContentVersion !== undefined && expectedContentVersion !== 0 && !requestedBatchId) {
      return NextResponse.json<BotBatchDraftResponse>(
        { success: false, message: 'expectedContentVersion 必须与 batchId 一起提供', successCount: 0, failedCount: 0, skippedCount: 0, warnedCount: 0, failed: [], skipped: [], warned: [], draftItems: [], draftTotal: 0 },
        { status: 400 }
      )
    }
    if (
      confirmed === true
      && (
        expectedContentVersion === undefined
        || typeof expectedWarningDigest !== 'string'
        || !/^[a-f0-9]{64}$/.test(expectedWarningDigest)
      )
    ) {
      return NextResponse.json<BotBatchDraftResponse>(
        { success: false, message: '确认写入必须包含版本和 warning digest', successCount: 0, failedCount: 0, skippedCount: 0, warnedCount: 0, failed: [], skipped: [], warned: [], draftItems: [], draftTotal: 0 },
        { status: 400 }
      )
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json<BotBatchDraftResponse>(
        { success: false, message: '缺少必需参数: items', successCount: 0, failedCount: 0, skippedCount: 0, warnedCount: 0, failed: [], skipped: [], warned: [], draftItems: [], draftTotal: 0 },
        { status: 400 }
      )
    }

    if (items.length > MAX_DRAFT_ITEMS) {
      return NextResponse.json<BotBatchDraftResponse>(
        { success: false, message: `一次最多写入 ${MAX_DRAFT_ITEMS} 条`, successCount: 0, failedCount: 0, skippedCount: 0, warnedCount: 0, failed: [], skipped: [], warned: [], draftItems: [], draftTotal: 0 },
        { status: 400 }
      )
    }

    for (let i = 0; i < items.length; i++) {
      const remark = items[i]?.remark
      if (
        typeof remark === 'string'
        && containsMiaomiaoReviewBlockDelimiter(remark)
      ) {
        return NextResponse.json<BotBatchDraftResponse>(
          { success: false, message: `项目 #${i + 1}: 备注不能包含喵喵复审块标记`, successCount: 0, failedCount: 0, skippedCount: 0, warnedCount: 0, failed: [], skipped: [], warned: [], draftItems: [], draftTotal: 0 },
          { status: 400 }
        )
      }
      if (items[i]?.needsManualReview !== undefined && typeof items[i].needsManualReview !== 'boolean') {
        return NextResponse.json<BotBatchDraftResponse>(
          { success: false, message: `项目 #${i + 1}: needsManualReview 必须是布尔值`, successCount: 0, failedCount: 0, skippedCount: 0, warnedCount: 0, failed: [], skipped: [], warned: [], draftItems: [], draftTotal: 0 },
          { status: 400 }
        )
      }
    }

    // Resolve or create draft batch
    let batchId = requestedBatchId
    let batchContentVersion = 0
    let batchIsVirtual = false
    if (batchId) {
      const batch = await prisma.batch.findUnique({
        where: { id: batchId },
        select: { id: true, creatorId: true, status: true, contentVersion: true },
      })
      if (!batch) {
        if (confirmed && expectedContentVersion === 0) {
          batchIsVirtual = true
        } else {
          return NextResponse.json<BotBatchDraftResponse>(
            { success: false, message: '批次不存在', successCount: 0, failedCount: 0, skippedCount: 0, warnedCount: 0, failed: [], skipped: [], warned: [], draftItems: [], draftTotal: 0 },
            { status: 404 }
          )
        }
      } else if (batch.creatorId !== user.id) {
        return NextResponse.json<BotBatchDraftResponse>(
          { success: false, message: '无权限操作此批次', successCount: 0, failedCount: 0, skippedCount: 0, warnedCount: 0, failed: [], skipped: [], warned: [], draftItems: [], draftTotal: 0 },
          { status: 403 }
        )
      }
      else if (batch.status !== 'Draft' && batch.status !== 'Rejected') {
        return NextResponse.json<BotBatchDraftResponse>(
          { success: false, message: '只能写入草稿状态的批次', successCount: 0, failedCount: 0, skippedCount: 0, warnedCount: 0, failed: [], skipped: [], warned: [], draftItems: [], draftTotal: 0 },
          { status: 400 }
        )
      }
      else if (expectedContentVersion !== undefined && batch.contentVersion !== expectedContentVersion) {
        return NextResponse.json<BotBatchDraftResponse>(
          { success: false, message: '批次内容已被修改，请刷新后重试', successCount: 0, failedCount: 0, skippedCount: 0, warnedCount: 0, failed: [], skipped: [], warned: [], draftItems: [], draftTotal: 0 },
          { status: 409 }
        )
      }
      else {
        batchContentVersion = batch.contentVersion
      }
    } else {
      // Same "current draft" selector the read endpoints use, so a write can
      // never land in a different batch than the one the user was just shown.
      const current = await findCurrentBotDraftBatch(prisma, user.id)
      if (!current) {
        // No draft at all: hand out a provisional id. Preview stops here;
        // a confirmed write materialises this exact id in the transaction.
        batchId = randomUUID()
        batchContentVersion = 0
        batchIsVirtual = true
      } else if (expectedContentVersion !== undefined && current.contentVersion !== expectedContentVersion) {
        // The caller planned against "no draft" (or an older version) but a
        // draft is there now — fail the CAS instead of writing blindly.
        return NextResponse.json<BotBatchDraftResponse>(
          { success: false, message: '批次内容已被修改，请刷新后重试', successCount: 0, failedCount: 0, skippedCount: 0, warnedCount: 0, failed: [], skipped: [], warned: [], draftItems: [], draftTotal: 0 },
          { status: 409 }
        )
      } else {
        batchId = current.id
        batchContentVersion = current.contentVersion
      }
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
        needsManualReview: item.needsManualReview ?? false,
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
    const skippedSlotWarnings = await buildSkippedCandidateSlotWarnings(conflictItems)

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

      // Warnings require a server-issued confirmation digest before writing.
      const isResolved = result.conflict.suggestions?.some(s => s.action === 'Resolved')
      const conflictReason = isResolved ? undefined : result.conflict.impact || undefined
      if (conflictReason) {
        warned.push({ index: i, word: item.word, code: item.code, reason: conflictReason })
      }
      toWrite.push({ item, conflictReason })
      // Mark this as "now in draft" so subsequent items in same request see it
      existingPRs.push({ action: item.action, word: item.word, oldWord: item.oldWord ?? null, code: item.code, type: item.type, weight: item.weight ?? null })
    }

    const serverWarnings = [
      ...skippedSlotWarnings.map((warning) => {
        const index = conflictItems.findIndex(item => item.id === warning.id)
        return {
          index: index >= 0 ? index : 0,
          item: normalizedItems[index >= 0 ? index : 0],
          warningType: 'skipped_candidate_slot' as const,
          message: warning.impact || '跳过了编码链中的更短空位，不建议直接写入更长编码',
          skippedCode: warning.skippedCode,
          skippedCodes: warning.skippedCodes,
        }
      }),
      ...warned.map((item) => ({
        index: item.index,
        item: normalizedItems[item.index],
        warningType: 'duplicate_code' as const,
        message: item.reason,
        existing: conflictResults[item.index]?.conflict.currentPhrase
          ? {
            word: conflictResults[item.index].conflict.currentPhrase!.word,
            code: conflictResults[item.index].conflict.currentPhrase!.code,
            weight: conflictResults[item.index].conflict.currentPhrase!.weight,
          }
          : undefined,
      })),
    ]
    // A batch that does not exist yet has no stable id to hash: use the shared
    // identity so preview and confirm agree (see NEW_BOT_DRAFT_BATCH_IDENTITY).
    const warningState = {
      targetBatchId: batchIsVirtual ? NEW_BOT_DRAFT_BATCH_IDENTITY : batchId,
      conflictResults,
      serverWarnings,
    }
    const warningDigest = await buildBotWarningDigest(prisma, conflictItems, warningState)

    if (confirmed === true && warningDigest !== expectedWarningDigest) {
      return NextResponse.json<BotBatchDraftResponse>(
        { success: false, message: '警告快照已变化，请重新确认', successCount: 0, failedCount: 0, skippedCount: 0, warnedCount: 0, failed: [], skipped: [], warned: [], draftItems: [], draftTotal: 0 },
        { status: 409 }
      )
    }

    // previewOnly is a compatibility hint, not the authorization boundary:
    // every request without an exact confirmed ticket must remain read-only.
    if (confirmed !== true) {
      return NextResponse.json<BotBatchDraftResponse>(
        {
          success: false,
          message: serverWarnings.length > 0
            ? `存在 ${serverWarnings.length} 个警告，请确认后再写入草稿`
            : `请确认将 ${toWrite.length} 个修改写入草稿`,
          batchId,
          contentVersion: batchContentVersion,
          warningDigest,
          successCount: 0,
          failedCount: failed.length,
          skippedCount: skipped.length,
          warnedCount: serverWarnings.length,
          failed,
          skipped,
          warned,
          warnings: serverWarnings,
          requiresConfirmation: true,
          draftItems: [],
          draftTotal: 0,
        },
        { status: 400 }
      )
    }

    // Write all accepted items in one transaction
    if (toWrite.length > 0) {
      await prisma.$transaction(async (tx) => {
        await lockBotDraftUser(tx, user.id)
        await assertNoOtherBotDraftWithContent(tx, user.id, batchId!)
        await lockPhraseTableForWarningSnapshot(tx)
        const lockedDigest = await buildBotWarningDigest(tx, conflictItems, warningState)
        if (lockedDigest !== warningDigest) {
          throw new BatchContentLockedError('警告快照已变化，请重新确认')
        }
        if (batchIsVirtual) {
          // First confirmed write materialises the provisional batch, but only
          // while the "no draft yet" baseline still holds under the lock.
          await assertNoBotDraftBatch(tx, user.id)
          await tx.batch.create({
            data: { id: batchId!, description: BOT_DRAFT_BATCH_DESCRIPTION, creatorId: user.id, status: 'Draft' },
          })
        }
        await claimBatchContentMutation(tx, batchId!, {
          creatorId: user.id,
          expectedContentVersion: batchContentVersion,
        })
        await Promise.all(
          toWrite.map(async ({ item, conflictReason }) => {
            const target = item.action === 'Change' || item.action === 'Delete'
              ? await tx.phrase.findFirst({
                where: {
                  word: item.action === 'Change' ? item.oldWord : item.word,
                  code: item.code,
                  type: item.type as PhraseType,
                },
                select: {
                  id: true, word: true, code: true, type: true, status: true,
                  weight: true, remark: true, userId: true,
                },
              })
              : null
            if ((item.action === 'Change' || item.action === 'Delete') && !target) {
              throw new BatchContentLockedError('目标词条已变化，请重新生成修改计划')
            }
            return tx.pullRequest.create({
            data: {
              word: item.word,
              oldWord: item.oldWord ?? undefined,
              code: item.code,
              action: item.action as PullRequestType,
              phraseId: target?.id,
              targetPhraseId: target?.id,
              targetFingerprint: target ? createPhraseTargetFingerprint(target) : null,
              needsManualReview: item.needsManualReview,
              type: item.type as PhraseType,
              weight: item.weight,
              remark: item.remark ?? null,
              userId: user.id,
              batchId: batchId!,
              hasConflict: false,
              conflictReason: conflictReason ?? null,
            },
            })
          })
        )
      })
      batchContentVersion += 1
    }

    // Fetch updated draft snapshot
    const updatedBatch = await prisma.batch.findUnique({
      where: { id: batchId! },
      select: {
        contentVersion: true,
        pullRequests: {
          orderBy: { createAt: 'asc' },
          select: { id: true, action: true, word: true, code: true, type: true, weight: true, status: true, conflictReason: true, needsManualReview: true },
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
      needsManualReview: pr.needsManualReview,
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
      contentVersion: updatedBatch?.contentVersion ?? batchContentVersion,
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
    if (error instanceof BatchContentLockedError) {
      return NextResponse.json<BotBatchDraftResponse>(
        { success: false, message: error.message, successCount: 0, failedCount: 0, skippedCount: 0, warnedCount: 0, failed: [], skipped: [], warned: [], draftItems: [], draftTotal: 0 },
        { status: error.status }
      )
    }
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
 * Requires a valid Bot token and a bound platform user
 *
 * Body: { platform, platformId, ids: number[] }
 * Only deletes items that belong to the caller and are in Draft status.
 */
export async function DELETE(request: NextRequest) {
  try {
    const rawBody = await request.clone().text()
    const body: unknown = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json<BotBatchDeleteDraftResponse>(
        { success: false, message: '请求格式错误', successCount: 0, failedCount: 0, deleted: [], failed: [], draftItems: [], draftTotal: 0 },
        { status: 400 }
      )
    }
    const payload = body as Record<string, unknown>
    const { platform, platformId, ids, batchId, expectedContentVersion } = payload
    const expectedTargets = parseExpectedBatchTargets(payload.expectedTargets)

    if (typeof platform !== 'string' || typeof platformId !== 'string') {
      return NextResponse.json<BotBatchDeleteDraftResponse>(
        { success: false, message: '平台身份格式错误', successCount: 0, failedCount: 0, deleted: [], failed: [], draftItems: [], draftTotal: 0 },
        { status: 400 }
      )
    }

    const auth = await requireVerifiedBotUser(platform, platformId, { request, rawBody })
    if (!auth.authorized) {
      return NextResponse.json<BotBatchDeleteDraftResponse>(
        { success: false, message: auth.message, successCount: 0, failedCount: 0, deleted: [], failed: [], draftItems: [], draftTotal: 0 },
        { status: auth.status }
      )
    }
    const user = auth.user

    if (
      typeof batchId !== 'string'
      || !batchId
      || !Number.isInteger(expectedContentVersion)
      || (expectedContentVersion as number) < 0
      || !expectedTargets
      || !Array.isArray(ids)
      || ids.length !== expectedTargets.length
      || ids.some((id, index) => id !== expectedTargets[index].id)
    ) {
      return NextResponse.json<BotBatchDeleteDraftResponse>(
        { success: false, message: '删除目标快照格式错误', successCount: 0, failedCount: 0, deleted: [], failed: [], draftItems: [], draftTotal: 0 },
        { status: 400 }
      )
    }

    if (ids.length > MAX_DELETE_ITEMS) {
      return NextResponse.json<BotBatchDeleteDraftResponse>(
        { success: false, message: `一次最多删除 ${MAX_DELETE_ITEMS} 条`, successCount: 0, failedCount: 0, deleted: [], failed: [], draftItems: [], draftTotal: 0 },
        { status: 400 }
      )
    }

    const updatedBatch = await prisma.$transaction(async (tx) => {
      await claimBatchContentMutation(tx, batchId, {
        creatorId: user.id,
        expectedContentVersion: expectedContentVersion as number,
      })
      const rows = await tx.pullRequest.findMany({
        where: { id: { in: ids as number[] }, batchId, userId: user.id },
        select: { id: true, action: true, word: true, code: true, type: true },
      })
      assertExpectedBatchTargets(expectedTargets, rows.map(row => ({
        id: row.id,
        word: row.word ?? '',
        code: row.code ?? '',
        action: row.action,
        type: row.type ?? 'Phrase',
      })))
      const removed = await tx.pullRequest.deleteMany({
        where: { id: { in: ids as number[] }, batchId, userId: user.id },
      })
      if (removed.count !== expectedTargets.length) throw new BatchTargetChangedError()
      return tx.batch.findUniqueOrThrow({
        where: { id: batchId },
        select: {
          contentVersion: true,
          pullRequests: {
            orderBy: { createAt: 'asc' },
            select: { id: true, action: true, word: true, code: true, type: true, weight: true, status: true, needsManualReview: true },
          },
        },
      })
    })

    const draftItems: BotDraftSnapshotItem[] = (updatedBatch?.pullRequests ?? []).map(pr => ({
      id: pr.id,
      action: pr.action,
      word: pr.word ?? '',
      code: pr.code ?? '',
      type: pr.type ?? 'Phrase',
      weight: pr.weight,
      status: pr.status,
      needsManualReview: pr.needsManualReview,
    }))

    const deleted: BotBatchDeleteDraftDeletedItem[] = expectedTargets.map(item => ({
      id: item.id, word: item.word, code: item.code, action: item.action,
    }))

    return NextResponse.json<BotBatchDeleteDraftResponse>({
      success: true,
      message: `成功删除 ${deleted.length} 条`,
      batchId,
      contentVersion: updatedBatch.contentVersion,
      successCount: deleted.length,
      failedCount: 0,
      deleted,
      failed: [],
      draftItems,
      draftTotal: draftItems.length,
    })
  } catch (error: unknown) {
    if (error instanceof BatchContentLockedError || error instanceof BatchTargetChangedError) {
      return NextResponse.json<BotBatchDeleteDraftResponse>(
        { success: false, message: error.message, successCount: 0, failedCount: 0, deleted: [], failed: [], draftItems: [], draftTotal: 0 },
        { status: error.status }
      )
    }
    console.error('[Bot API] batch-draft DELETE error:', error)
    const msg = error instanceof Error ? error.message : '未知错误'
    return NextResponse.json<BotBatchDeleteDraftResponse>(
      { success: false, message: `批量删除失败：${msg}`, successCount: 0, failedCount: 0, deleted: [], failed: [], draftItems: [], draftTotal: 0 },
      { status: 500 }
    )
  }
}
