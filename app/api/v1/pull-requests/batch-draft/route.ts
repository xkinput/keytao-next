import { NextRequest, NextResponse } from 'next/server'
import { PullRequestType } from '@prisma/client'
import type { Prisma } from '@prisma/client'

import { verifyApiKey } from '@/lib/apiKeyAuth'
import { prisma } from '@/lib/prisma'
import { detectPhraseType, isValidPhraseType, type PhraseType } from '@/lib/constants/phraseTypes'
import { checkBatchConflictsWithWeight } from '@/lib/services/batchConflictService'
import { resolvePhraseTargetBinding } from '@/lib/services/phraseTargetBinding'
import {
  BatchContentLockedError,
  claimBatchContentMutation,
  lockBotDraftUser,
} from '@/lib/services/batchContentGuard'
import type {
  BotBatchDraftFailedItem,
  BotBatchDraftItem,
  BotBatchDraftResponse,
  BotBatchDeleteDraftDeletedItem,
  BotBatchDeleteDraftFailedItem,
  BotBatchDeleteDraftResponse,
  BotDraftSnapshotItem,
} from '@/lib/types/bot'

interface UserBatchDraftRequest {
  items: BotBatchDraftItem[]
  batchId?: string
  expectedContentVersion?: number
}

interface UserBatchDeleteDraftRequest {
  ids: number[]
  batchId?: string
  expectedContentVersion?: number
}

const API_DRAFT_DESCRIPTION_PREFIX = '个人 API 草稿批次'
const MAX_DRAFT_ITEMS = 500
const MAX_DELETE_ITEMS = 500
const MAX_WORD_LENGTH = 100
const MAX_CODE_LENGTH = 20
const MAX_REMARK_LENGTH = 500

export async function GET(request: NextRequest) {
  const auth = await verifyApiKey()
  if (!auth.success) return auth.response

  const requestedBatchId = request.nextUrl.searchParams.get('batchId')
  if (requestedBatchId && requestedBatchId.length > 100) {
    return NextResponse.json<BotBatchDraftResponse>(
      emptyDraftResponse('batchId 格式错误'),
      { status: 400 }
    )
  }

  const batch = await prisma.batch.findFirst({
    where: {
      ...(requestedBatchId ? { id: requestedBatchId } : {}),
      creatorId: auth.ctx.userId,
      status: 'Draft',
      description: { startsWith: API_DRAFT_DESCRIPTION_PREFIX },
    },
    orderBy: { createAt: 'desc' },
    select: { id: true, contentVersion: true },
  })

  if (requestedBatchId && !batch) {
    return NextResponse.json<BotBatchDraftResponse>(
      emptyDraftResponse('草稿批次不存在'),
      { status: 404 }
    )
  }

  const draftItems = batch ? await getDraftItems(prisma, batch.id) : []
  return NextResponse.json<BotBatchDraftResponse>({
    success: true,
    message: batch ? '已获取个人 API 草稿' : '当前没有个人 API 草稿',
    ...(batch ? { batchId: batch.id } : {}),
    contentVersion: batch?.contentVersion ?? 0,
    successCount: 0,
    failedCount: 0,
    skippedCount: 0,
    warnedCount: 0,
    failed: [],
    skipped: [],
    warned: [],
    draftItems,
    draftTotal: draftItems.length,
  })
}

export async function POST(request: NextRequest) {
  try {
    const auth = await verifyApiKey()
    if (!auth.success) return auth.response

    const body: UserBatchDraftRequest = await request.json()
    const { items, batchId: requestedBatchId, expectedContentVersion } = body
    const userId = auth.ctx.userId

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json<BotBatchDraftResponse>(
        emptyDraftResponse('缺少必需参数'),
        { status: 400 }
      )
    }

    if (items.length > MAX_DRAFT_ITEMS) {
      return NextResponse.json<BotBatchDraftResponse>(
        emptyDraftResponse(`一次最多写入 ${MAX_DRAFT_ITEMS} 条`),
        { status: 400 }
      )
    }

    if (expectedContentVersion === undefined) {
      return NextResponse.json<BotBatchDraftResponse>(
        emptyDraftResponse('缺少有效的 expectedContentVersion，请刷新草稿后重试'),
        { status: 409 }
      )
    }
    if (!isContentVersion(expectedContentVersion)) {
      return NextResponse.json<BotBatchDraftResponse>(
        emptyDraftResponse('expectedContentVersion 必须是非负整数'),
        { status: 400 }
      )
    }

    const normalizedItems = items.map((item) => {
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

    const conflictItems = normalizedItems.map((item, idx) => ({
      id: String(idx),
      action: item.action,
      word: item.word,
      oldWord: item.oldWord,
      code: item.code,
      type: item.type as PhraseType,
      weight: item.weight,
    }))
    const result = await prisma.$transaction(async (tx) => {
      await lockBotDraftUser(tx, userId)
      let batchId: string
      if (requestedBatchId) {
        const batch = await tx.batch.findUnique({
          where: { id: requestedBatchId },
          select: { id: true, creatorId: true, status: true, contentVersion: true },
        })
        if (!batch) throw new DraftRequestError('批次不存在', 404)
        if (batch.creatorId !== userId) throw new DraftRequestError('无权限操作此批次', 403)
        if (batch.status !== 'Draft') throw new DraftRequestError('只能写入草稿状态的批次', 400)
        batchId = batch.id
      } else {
        const existingBatch = await tx.batch.findFirst({
          where: {
            creatorId: userId,
            status: 'Draft',
            description: { startsWith: API_DRAFT_DESCRIPTION_PREFIX },
          },
          orderBy: { createAt: 'desc' },
          select: { id: true, contentVersion: true },
        })
        const batch = existingBatch ?? await tx.batch.create({
          data: { description: API_DRAFT_DESCRIPTION_PREFIX, creatorId: userId, status: 'Draft' },
          select: { id: true, contentVersion: true },
        })
        batchId = batch.id
      }

      // The claim must happen before any decision derived from current draft content.
      await claimBatchContentMutation(tx, batchId, {
        creatorId: userId,
        expectedContentVersion,
        allowedStatuses: ['Draft'],
      })

      const [conflictResults, existingPRs] = await Promise.all([
        checkBatchConflictsWithWeight(conflictItems),
        tx.pullRequest.findMany({
          where: { batchId },
          select: { action: true, word: true, oldWord: true, code: true, type: true, weight: true },
        }),
      ])
      const failed: BotBatchDraftFailedItem[] = []
      const skipped: BotBatchDraftFailedItem[] = []
      const warned: BotBatchDraftFailedItem[] = []
      const toWrite: Array<{ item: typeof normalizedItems[0]; conflictReason?: string }> = []

      for (let i = 0; i < normalizedItems.length; i++) {
        const item = normalizedItems[i]
        const conflictResult = conflictResults[i]

        if (conflictResult.conflict.hasConflict) {
          failed.push({
            index: i,
            word: item.word,
            code: item.code,
            reason: conflictResult.conflict.impact || '冲突',
          })
          continue
        }

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

        const isResolved = conflictResult.conflict.suggestions?.some(s => s.action === 'Resolved')
        const conflictReason = isResolved ? undefined : conflictResult.conflict.impact || undefined
        if (conflictReason) {
          warned.push({ index: i, word: item.word, code: item.code, reason: conflictReason })
        }
        toWrite.push({ item, conflictReason })
        existingPRs.push({
          action: item.action,
          word: item.word,
          oldWord: item.oldWord ?? null,
          code: item.code,
          type: item.type,
          weight: item.weight ?? null,
        })
      }

      await Promise.all(toWrite.map(async ({ item, conflictReason }) => {
        const binding = await resolvePhraseTargetBinding(tx.phrase, item)
        return tx.pullRequest.create({
          data: {
            word: item.word,
            oldWord: item.oldWord ?? undefined,
            code: item.code,
            action: item.action as PullRequestType,
            phraseId: binding.targetPhraseId,
            targetPhraseId: binding.targetPhraseId,
            targetFingerprint: binding.targetFingerprint,
            type: item.type as PhraseType,
            weight: item.weight,
            remark: item.remark ?? null,
            userId,
            batchId,
            hasConflict: false,
            conflictReason: conflictReason ?? null,
          },
        })
      }))

      return {
        batchId,
        contentVersion: expectedContentVersion + 1,
        successCount: toWrite.length,
        failed,
        skipped,
        warned,
        draftItems: await getDraftItems(tx, batchId),
      }
    })

    const failedCount = result.failed.length
    const skippedCount = result.skipped.length
    const warnedCount = result.warned.length

    const parts: string[] = [`成功写入 ${result.successCount} 条`]
    if (failedCount > 0) parts.push(`冲突 ${failedCount} 条`)
    if (skippedCount > 0) parts.push(`跳过重复 ${skippedCount} 条`)
    if (warnedCount > 0) parts.push(`重码警告 ${warnedCount} 条`)

    return NextResponse.json<BotBatchDraftResponse>({
      success: true,
      message: parts.join('，'),
      batchId: result.batchId,
      contentVersion: result.contentVersion,
      successCount: result.successCount,
      failedCount,
      skippedCount,
      warnedCount,
      failed: result.failed,
      skipped: result.skipped,
      warned: result.warned,
      draftItems: result.draftItems,
      draftTotal: result.draftItems.length,
    })
  } catch (error) {
    if (error instanceof BatchContentLockedError || error instanceof DraftRequestError) {
      return NextResponse.json<BotBatchDraftResponse>(
        emptyDraftResponse(error.message),
        { status: error.status }
      )
    }
    console.error('[API v1] batch-draft error:', error)
    const msg = error instanceof Error ? error.message : '未知错误'
    return NextResponse.json<BotBatchDraftResponse>(
      emptyDraftResponse(`批量写入失败：${msg}`),
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await verifyApiKey()
    if (!auth.success) return auth.response

    const body: UserBatchDeleteDraftRequest = await request.json()
    const { ids, batchId, expectedContentVersion } = body
    const userId = auth.ctx.userId

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json<BotBatchDeleteDraftResponse>(
        emptyDeleteResponse('缺少必需参数'),
        { status: 400 }
      )
    }

    if (ids.length > MAX_DELETE_ITEMS || ids.some(id => !Number.isInteger(id) || id <= 0)) {
      return NextResponse.json<BotBatchDeleteDraftResponse>(
        emptyDeleteResponse(`一次最多删除 ${MAX_DELETE_ITEMS} 条，且 ID 必须为正整数`),
        { status: 400 }
      )
    }

    if (!batchId || expectedContentVersion === undefined) {
      return NextResponse.json<BotBatchDeleteDraftResponse>(
        emptyDeleteResponse('缺少有效的 batchId 或 expectedContentVersion，请刷新草稿后重试'),
        { status: 409 }
      )
    }
    if (!isContentVersion(expectedContentVersion)) {
      return NextResponse.json<BotBatchDeleteDraftResponse>(
        emptyDeleteResponse('expectedContentVersion 必须是非负整数'),
        { status: 400 }
      )
    }

    const result = await prisma.$transaction(async (tx) => {
      await claimBatchContentMutation(tx, batchId, {
        creatorId: userId,
        expectedContentVersion,
        allowedStatuses: ['Draft'],
      })

      const uniqueIds = [...new Set(ids)]
      const prs = await tx.pullRequest.findMany({
        where: { id: { in: uniqueIds }, batchId, userId },
        select: {
          id: true,
          action: true,
          word: true,
          code: true,
          userId: true,
          batchId: true,
          type: true,
          weight: true,
          status: true,
          conflictReason: true,
        },
      })
      const prMap = new Map(prs.map(pr => [pr.id, pr]))
      const deleted: BotBatchDeleteDraftDeletedItem[] = []
      const failed: BotBatchDeleteDraftFailedItem[] = []

      for (const id of uniqueIds) {
        const pr = prMap.get(id)
        if (!pr) {
          failed.push({ id, reason: '条目不存在或不属于当前草稿' })
          continue
        }
        deleted.push({ id, word: pr.word ?? '', code: pr.code ?? '', action: pr.action })
      }

      if (deleted.length > 0) {
        const deletion = await tx.pullRequest.deleteMany({
          where: { id: { in: deleted.map(item => item.id) }, userId, batchId },
        })
        if (deletion.count !== deleted.length) {
          throw new BatchContentLockedError('批次内容已被其他操作修改，请刷新后重试')
        }
      }

      return {
        deleted,
        failed,
        draftItems: await getDraftItems(tx, batchId),
      }
    })

    const parts: string[] = [`成功删除 ${result.deleted.length} 条`]
    if (result.failed.length > 0) parts.push(`失败 ${result.failed.length} 条`)

    return NextResponse.json<BotBatchDeleteDraftResponse>({
      success: true,
      message: parts.join('，'),
      batchId,
      contentVersion: expectedContentVersion + 1,
      successCount: result.deleted.length,
      failedCount: result.failed.length,
      deleted: result.deleted,
      failed: result.failed,
      draftItems: result.draftItems,
      draftTotal: result.draftItems.length,
    })
  } catch (error) {
    if (error instanceof BatchContentLockedError) {
      return NextResponse.json<BotBatchDeleteDraftResponse>(
        emptyDeleteResponse(error.message),
        { status: error.status }
      )
    }
    console.error('[API v1] batch-draft DELETE error:', error)
    const msg = error instanceof Error ? error.message : '未知错误'
    return NextResponse.json<BotBatchDeleteDraftResponse>(
      emptyDeleteResponse(`批量删除失败：${msg}`),
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

async function getDraftItems(
  tx: Pick<Prisma.TransactionClient, 'pullRequest'>,
  batchId: string
): Promise<BotDraftSnapshotItem[]> {
  const pullRequests = await tx.pullRequest.findMany({
    where: { batchId },
    orderBy: { createAt: 'asc' },
    select: {
      id: true,
      action: true,
      word: true,
      code: true,
      type: true,
      weight: true,
      status: true,
      conflictReason: true,
    },
  })

  return pullRequests.map(pr => ({
    id: pr.id,
    action: pr.action,
    word: pr.word ?? '',
    code: pr.code ?? '',
    type: pr.type ?? 'Phrase',
    weight: pr.weight,
    status: pr.status,
    ...(pr.conflictReason && { hasWarning: true, warningNote: pr.conflictReason }),
  }))
}

function isContentVersion(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0
}

class DraftRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'DraftRequestError'
  }
}

function emptyDraftResponse(message: string): BotBatchDraftResponse {
  return {
    success: false,
    message,
    successCount: 0,
    failedCount: 0,
    skippedCount: 0,
    warnedCount: 0,
    failed: [],
    skipped: [],
    warned: [],
    draftItems: [],
    draftTotal: 0,
  }
}

function emptyDeleteResponse(message: string): BotBatchDeleteDraftResponse {
  return {
    success: false,
    message,
    successCount: 0,
    failedCount: 0,
    deleted: [],
    failed: [],
    draftItems: [],
    draftTotal: 0,
  }
}
