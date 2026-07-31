import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireVerifiedBotUser } from '@/lib/botUserAuth'
import { checkBatchConflictsWithWeight } from '@/lib/services/batchConflictService'
import { buildDependencies } from '@/lib/services/batchDependencyService'
import { buildSkippedCandidateSlotWarnings } from '@/lib/services/batchSkippedCodeWarnings'
import { PullRequestType } from '@prisma/client'
import { PhraseType } from '@/lib/constants/phraseTypes'
import type { BotCreatePRRequest, BotCreatePRResponse, BotConflictInfo, BotWarningInfo, BotDeleteNoteInfo } from '@/lib/types/bot'
import { assertNoOtherBotDraftWithContent, BatchContentLockedError, claimBatchContentMutation, lockBotDraftUser } from '@/lib/services/batchContentGuard'
import {
  buildBotWarningDigest,
  lockPhraseTableForWarningSnapshot,
} from '@/lib/services/botWarningSnapshot'
import { createPhraseTargetFingerprint } from '@/lib/services/phraseTargetBinding'
import { randomUUID } from 'crypto'

const MAX_ITEMS = 500
const MAX_WORD_LENGTH = 100
const MAX_CODE_LENGTH = 20
const MAX_REMARK_LENGTH = 500

/**
 * Bot API: Create PRs in batch
 * POST /api/bot/pull-requests/batch
 * Requires a valid Bot token and a bound platform user
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.clone().text()
    const body: BotCreatePRRequest = await request.json()
    const {
      platform,
      platformId,
      items,
      confirmed,
      batchId,
      expectedContentVersion,
      expectedWarningDigest,
      previewOnly = false,
    } = body

    console.log('[Bot API] Received request:', {
      platform,
      platformId,
      confirmed,
      batchId,
      itemsCount: items?.length,
      items: items?.map(i => ({ action: i.action, word: i.word, code: i.code }))
    })

    const auth = await requireVerifiedBotUser(platform, platformId, { request, rawBody })
    if (!auth.authorized) {
      return NextResponse.json<BotCreatePRResponse>(
        {
          success: false,
          message: auth.message
        },
        { status: auth.status }
      )
    }
    const user = auth.user

    if (confirmed !== undefined && typeof confirmed !== 'boolean') {
      return NextResponse.json<BotCreatePRResponse>(
        { success: false, message: 'confirmed 类型错误' },
        { status: 400 }
      )
    }
    if (typeof previewOnly !== 'boolean' || (previewOnly && confirmed === true)) {
      return NextResponse.json<BotCreatePRResponse>(
        { success: false, message: 'previewOnly 类型错误，且不能与 confirmed 同时为 true' },
        { status: 400 }
      )
    }

    if (
      expectedContentVersion !== undefined
      && (!Number.isInteger(expectedContentVersion) || expectedContentVersion < 0)
    ) {
      return NextResponse.json<BotCreatePRResponse>(
        { success: false, message: 'expectedContentVersion 类型错误' },
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
      return NextResponse.json<BotCreatePRResponse>(
        { success: false, message: '确认写入必须包含版本和 warning digest' },
        { status: 400 }
      )
    }

    // Validate parameters
    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json<BotCreatePRResponse>(
        {
          success: false,
          message: '缺少必需参数: items'
        },
        { status: 400 }
      )
    }

    if (items.length > MAX_ITEMS) {
      return NextResponse.json<BotCreatePRResponse>(
        {
          success: false,
          message: `一次最多创建 ${MAX_ITEMS} 个修改提议`
        },
        { status: 400 }
      )
    }

    // Validate all items
    const validationItems = items.map((item, idx) => ({
      id: idx.toString(),
      action: item.action as 'Create' | 'Change' | 'Delete',
      word: item.word || '',
      oldWord: item.oldWord || undefined,
      code: item.code || '',
      type: (item.type || 'Phrase') as PhraseType,
      weight: item.weight ?? undefined
    }))

    // Check for basic validation errors
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (!item.word || !item.code || !item.action) {
        return NextResponse.json<BotCreatePRResponse>(
          {
            success: false,
            message: `项目 #${i + 1}: 缺少必要字段（word/code/action）`
          },
          { status: 400 }
        )
      }
      if (!['Create', 'Change', 'Delete'].includes(item.action)) {
        return NextResponse.json<BotCreatePRResponse>(
          { success: false, message: `项目 #${i + 1}: 不支持的操作类型` },
          { status: 400 }
        )
      }
      if (item.word.length > MAX_WORD_LENGTH || item.code.length > MAX_CODE_LENGTH) {
        return NextResponse.json<BotCreatePRResponse>(
          { success: false, message: `项目 #${i + 1}: 词条或编码过长` },
          { status: 400 }
        )
      }
      if (item.oldWord && item.oldWord.length > MAX_WORD_LENGTH) {
        return NextResponse.json<BotCreatePRResponse>(
          { success: false, message: `项目 #${i + 1}: 旧词过长` },
          { status: 400 }
        )
      }
      if (item.remark && item.remark.length > MAX_REMARK_LENGTH) {
        return NextResponse.json<BotCreatePRResponse>(
          { success: false, message: `项目 #${i + 1}: 备注过长` },
          { status: 400 }
        )
      }
      if (item.needsManualReview !== undefined && typeof item.needsManualReview !== 'boolean') {
        return NextResponse.json<BotCreatePRResponse>(
          { success: false, message: `项目 #${i + 1}: needsManualReview 必须是布尔值` },
          { status: 400 }
        )
      }
      if (item.action === 'Change' && !item.oldWord) {
        return NextResponse.json<BotCreatePRResponse>(
          {
            success: false,
            message: `项目 #${i + 1}: 修改操作需要指定旧词（oldWord）`
          },
          { status: 400 }
        )
      }
    }

    // Run conflict detection
    const existingBatchSnapshot = batchId
      ? await prisma.batch.findUnique({
        where: { id: batchId },
        select: { id: true, creatorId: true, status: true, contentVersion: true },
      })
      : null

    if (batchId && !existingBatchSnapshot && !previewOnly && confirmed !== true) {
      return NextResponse.json<BotCreatePRResponse>({ success: false, message: '批次不存在' }, { status: 404 })
    }
    if (existingBatchSnapshot && existingBatchSnapshot.creatorId !== user.id) {
      return NextResponse.json<BotCreatePRResponse>({ success: false, message: '无权限操作此批次' }, { status: 403 })
    }
    if (existingBatchSnapshot && !['Draft', 'Rejected'].includes(existingBatchSnapshot.status)) {
      return NextResponse.json<BotCreatePRResponse>({ success: false, message: '批次不可编辑' }, { status: 409 })
    }
    if (
      existingBatchSnapshot
      && expectedContentVersion !== undefined
      && existingBatchSnapshot.contentVersion !== expectedContentVersion
    ) {
      return NextResponse.json<BotCreatePRResponse>(
        { success: false, message: '批次内容已被修改，请刷新后重试' },
        { status: 409 }
      )
    }
    if (!existingBatchSnapshot && confirmed === true && expectedContentVersion !== 0) {
      return NextResponse.json<BotCreatePRResponse>(
        { success: false, message: '新批次的 expectedContentVersion 必须为 0' },
        { status: 409 }
      )
    }

    const results = await checkBatchConflictsWithWeight(validationItems)
    const skippedSlotWarnings = await buildSkippedCandidateSlotWarnings(validationItems)

    // Categorize results: conflicts (真冲突) vs warnings (重码警告) vs notes (删除信息)
    const conflicts: BotConflictInfo[] = []
    const warnings: BotWarningInfo[] = []
    const notes: BotDeleteNoteInfo[] = []

    for (let i = 0; i < results.length; i++) {
      const result = results[i]
      const item = items[i]

      // Check if resolved within batch
      const isResolved = result.conflict.suggestions?.some(sug => sug.action === 'Resolved')

      if (result.conflict.hasConflict) {
        // True conflict - must reject
        conflicts.push({
          index: i,
          item,
          error: result.conflict.impact || '操作冲突',
          reason: result.conflict.suggestions?.[0]?.reason || '未知原因'
        })
      } else if (item.action === 'Delete' && result.conflict.currentPhrase) {
        // Delete: non-blocking, but record what will be deleted for informational purposes
        notes.push({
          index: i,
          word: result.conflict.currentPhrase.word,
          code: result.conflict.currentPhrase.code,
          weight: result.conflict.currentPhrase.weight,
          type: result.conflict.currentPhrase.type ?? undefined,
        })
      } else if (
        result.conflict.currentPhrase &&
        !isResolved &&
        !(item.action === 'Change' && result.conflict.currentPhrase.word === item.oldWord)
      ) {
        // Warning - needs confirmation (Create/Change only)
        const isDuplicateCode = result.conflict.currentPhrase.code === item.code &&
          result.conflict.currentPhrase.word !== item.word

        warnings.push({
          index: i,
          item,
          warningType: isDuplicateCode ? 'duplicate_code' : 'multiple_code',
          message: result.conflict.impact || '存在警告',
          existing: {
            word: result.conflict.currentPhrase.word,
            code: result.conflict.currentPhrase.code,
            weight: result.conflict.currentPhrase.weight
          }
        })
      }
    }

    for (const warning of skippedSlotWarnings) {
      const index = validationItems.findIndex(item => item.id === warning.id)
      if (index < 0) continue
      warnings.push({
        index,
        item: items[index],
        warningType: 'skipped_candidate_slot',
        message: warning.impact || '跳过了编码链中的更短空位，不建议直接写入更长编码',
        skippedCode: warning.skippedCode,
        skippedCodes: warning.skippedCodes,
      })
    }

    const targetBatchId = existingBatchSnapshot?.id ?? batchId ?? randomUUID()
    const warningState = { targetBatchId, results, warnings, skippedSlotWarnings }
    const warningDigest = await buildBotWarningDigest(prisma, validationItems, warningState)

    if (confirmed === true && warningDigest !== expectedWarningDigest) {
      return NextResponse.json<BotCreatePRResponse>(
        { success: false, message: '警告快照已变化，请重新确认' },
        { status: 409 }
      )
    }

    // If there are true conflicts, reject immediately
    if (conflicts.length > 0) {
      return NextResponse.json<BotCreatePRResponse>(
        {
          success: false,
          conflicts,
          message: `存在 ${conflicts.length} 个无法解决的冲突`
        },
        { status: 400 }
      )
    }

    // Every unconfirmed request is read-only, including legacy callers that do
    // not send previewOnly. Only an exact server ticket may reach the write
    // transaction with confirmed=true.
    if (confirmed !== true) {
      const responseData = {
        success: false,
        warnings,
        requiresConfirmation: true,
        batchId: targetBatchId,
        contentVersion: existingBatchSnapshot?.contentVersion ?? 0,
        warningDigest,
        message: warnings.length > 0
          ? `存在 ${warnings.length} 个需要确认的警告（重码、多编码或跳过编码空位）`
          : `请确认将 ${items.length} 个修改写入草稿`
      }
      console.log('[Bot API] Returning warnings response:', JSON.stringify(responseData, null, 2))
      return NextResponse.json<BotCreatePRResponse>(responseData)
    }

    // Check for duplicates in existing draft batch
    if (batchId) {
      const existingPRs = await prisma.pullRequest.findMany({
        where: {
          batchId: batchId
        },
        select: {
          action: true,
          word: true,
          oldWord: true,
          code: true,
          type: true,
          weight: true
        }
      })

      // Check each item for duplicates
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        const isDuplicate = existingPRs.some(
          pr => pr.action === item.action &&
            pr.word === item.word &&
            pr.oldWord === (item.oldWord ?? null) &&
            pr.code === item.code &&
            (pr.type ?? 'Phrase') === (item.type || 'Phrase') &&
            (pr.weight ?? undefined) === item.weight
        )

        if (isDuplicate) {
          const actionName = item.action === 'Create' ? '添加' :
            item.action === 'Change' ? '修改' : '删除'
          return NextResponse.json<BotCreatePRResponse>(
            {
              success: false,
              message: `草稿批次中已存在相同的修改：${actionName}词条【${item.word}】(编码: ${item.code})\n\n请勿重复添加，可以直接提交审核哦～`
            },
            { status: 400 }
          )
        }
      }
    }

    // Create batch and PRs (same logic as frontend)
    const result = await prisma.$transaction(async (tx) => {
      await lockBotDraftUser(tx, user.id)
      await assertNoOtherBotDraftWithContent(tx, user.id, targetBatchId)
      await lockPhraseTableForWarningSnapshot(tx)
      const lockedDigest = await buildBotWarningDigest(tx, validationItems, warningState)
      if (lockedDigest !== warningDigest) {
        throw new BatchContentLockedError('警告快照已变化，请重新确认')
      }
      // Use existing batch or create new one
      let batch
      if (existingBatchSnapshot) {
        // Find existing batch
        batch = await tx.batch.findUnique({
          where: { id: existingBatchSnapshot.id },
          select: {
            id: true,
            creatorId: true,
            status: true,
            description: true,
            contentVersion: true,
          }
        })

        if (!batch) {
          throw new Error('批次不存在')
        }

        if (batch.creatorId !== user.id) {
          throw new Error('无权限操作此批次')
        }

        if (batch.status !== 'Draft' && batch.status !== 'Rejected') {
          throw new Error('批次已提交，无法继续添加')
        }
        await claimBatchContentMutation(tx, batch.id, {
          creatorId: user.id,
            expectedContentVersion: existingBatchSnapshot.contentVersion,
        })
      } else {
        // Create new batch
        batch = await tx.batch.create({
          data: {
            id: targetBatchId,
            description: items.length === 1
              ? `键道助手添加: ${items[0].word}`
              : `键道助手批量添加 ${items.length} 个词条`,
            creatorId: user.id,
            status: 'Draft'
          }
        })
        await claimBatchContentMutation(tx, batch.id, {
          creatorId: user.id,
          expectedContentVersion: batch.contentVersion,
        })
      }

      // Create all PRs
      const prs = await Promise.all(
        items.map(async (item, idx) => {
          const target = item.action === 'Change' || item.action === 'Delete'
            ? await tx.phrase.findFirst({
              where: {
                word: item.action === 'Change' ? item.oldWord : item.word,
                code: item.code,
                type: (item.type || 'Phrase') as PhraseType,
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
              oldWord: item.oldWord || undefined,
              code: item.code,
              action: item.action as PullRequestType,
              phraseId: target?.id,
              targetPhraseId: target?.id,
              targetFingerprint: target ? createPhraseTargetFingerprint(target) : null,
              needsManualReview: item.needsManualReview ?? false,
              weight: item.weight ?? undefined,
              remark: item.remark || null,
              type: (item.type || 'Phrase') as PhraseType,
              userId: user.id,
              batchId: batch.id,
              hasConflict: false,
              conflictReason: results[idx]?.conflict?.suggestions?.some(s => s.action === 'Resolved')
                ? null
                : results[idx]?.conflict?.impact || null,
            }
          })
        })
      )

      // Build dependencies if conflicts are resolved within batch
      await buildDependencies(prs, results, tx)

      return { batch, prs, contentVersion: batch.contentVersion + 1 }
    })

    const responseData: BotCreatePRResponse = {
      success: true,
      batchId: result.batch.id,
      pullRequestCount: result.prs.length,
      contentVersion: result.contentVersion,
      message: `成功创建批次，包含 ${result.prs.length} 个修改提议`,
      ...(notes.length > 0 && { notes }),
    }
    console.log('[Bot API] Returning success response:', JSON.stringify(responseData, null, 2))
    return NextResponse.json<BotCreatePRResponse>(responseData)
  } catch (error: unknown) {
    if (error instanceof BatchContentLockedError) {
      return NextResponse.json<BotCreatePRResponse>(
        { success: false, message: error.message },
        { status: error.status }
      )
    }
    console.error('[Bot API] Error:', error)
    const errorCode = typeof error === 'object' && error !== null && 'code' in error ? (error as { code?: string }).code : undefined
    const errorMessage = error instanceof Error ? error.message : '未知错误'

    // Handle specific error types
    if (errorCode === 'P2022') {
      // Prisma column not found
      return NextResponse.json<BotCreatePRResponse>(
        {
          success: false,
          message: '数据库配置错误，请联系管理员检查数据库迁移状态'
        },
        { status: 500 }
      )
    }

    if (errorCode === 'P2025') {
      // Record not found
      return NextResponse.json<BotCreatePRResponse>(
        {
          success: false,
          message: '未找到绑定账号。\n\n请先使用 /bind 命令绑定你的平台账号到键道加词平台～'
        },
        { status: 404 }
      )
    }

    // Generic error
    return NextResponse.json<BotCreatePRResponse>(
        {
          success: false,
          message: `创建失败：${errorMessage}`
        },
      { status: 500 }
    )
  }
}
