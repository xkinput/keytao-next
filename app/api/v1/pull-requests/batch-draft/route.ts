import { NextRequest, NextResponse } from 'next/server'
import { PullRequestType } from '@prisma/client'

import { verifyApiKey } from '@/lib/apiKeyAuth'
import { prisma } from '@/lib/prisma'
import { detectPhraseType, isValidPhraseType, type PhraseType } from '@/lib/constants/phraseTypes'
import { checkBatchConflictsWithWeight } from '@/lib/services/batchConflictService'
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
}

interface UserBatchDeleteDraftRequest {
  ids: number[]
}

const API_DRAFT_DESCRIPTION_PREFIX = '个人 API 草稿批次'
const MAX_DRAFT_ITEMS = 500
const MAX_DELETE_ITEMS = 500
const MAX_WORD_LENGTH = 100
const MAX_CODE_LENGTH = 20
const MAX_REMARK_LENGTH = 500

export async function POST(request: NextRequest) {
  try {
    const auth = await verifyApiKey()
    if (!auth.success) return auth.response

    const body: UserBatchDraftRequest = await request.json()
    const { items, batchId: requestedBatchId } = body
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

    let batchId = requestedBatchId
    if (batchId) {
      const batch = await prisma.batch.findUnique({
        where: { id: batchId },
        select: { id: true, creatorId: true, status: true },
      })
      if (!batch) {
        return NextResponse.json<BotBatchDraftResponse>(
          emptyDraftResponse('批次不存在'),
          { status: 404 }
        )
      }
      if (batch.creatorId !== userId) {
        return NextResponse.json<BotBatchDraftResponse>(
          emptyDraftResponse('无权限操作此批次'),
          { status: 403 }
        )
      }
      if (batch.status !== 'Draft') {
        return NextResponse.json<BotBatchDraftResponse>(
          emptyDraftResponse('只能写入草稿状态的批次'),
          { status: 400 }
        )
      }
    } else {
      let batch = await prisma.batch.findFirst({
        where: { creatorId: userId, status: 'Draft', description: { startsWith: API_DRAFT_DESCRIPTION_PREFIX } },
        orderBy: { createAt: 'desc' },
        select: { id: true },
      })
      if (!batch) {
        batch = await prisma.batch.create({
          data: { description: API_DRAFT_DESCRIPTION_PREFIX, creatorId: userId, status: 'Draft' },
          select: { id: true },
        })
      }
      batchId = batch.id
    }

    const existingPRs = await prisma.pullRequest.findMany({
      where: { batchId },
      select: { action: true, word: true, oldWord: true, code: true, type: true, weight: true },
    })

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
    const conflictResults = await checkBatchConflictsWithWeight(conflictItems)

    const failed: BotBatchDraftFailedItem[] = []
    const skipped: BotBatchDraftFailedItem[] = []
    const warned: BotBatchDraftFailedItem[] = []
    const toWrite: Array<{ item: typeof normalizedItems[0]; conflictReason?: string }> = []

    for (let i = 0; i < normalizedItems.length; i++) {
      const item = normalizedItems[i]
      const result = conflictResults[i]

      if (result.conflict.hasConflict) {
        failed.push({
          index: i,
          word: item.word,
          code: item.code,
          reason: result.conflict.impact || '冲突',
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

      const isResolved = result.conflict.suggestions?.some(s => s.action === 'Resolved')
      const conflictReason = isResolved ? undefined : result.conflict.impact || undefined
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
              userId,
              batchId: batchId!,
              hasConflict: false,
              conflictReason: conflictReason ?? null,
            },
          })
        )
      )
    }

    const draftItems = await getDraftItems(batchId!)
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
  } catch (error) {
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
    const { ids } = body
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

    const prs = await prisma.pullRequest.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        action: true,
        word: true,
        code: true,
        userId: true,
        batchId: true,
        batch: { select: { id: true, status: true, creatorId: true } },
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
      if (pr.userId !== userId || pr.batch?.creatorId !== userId) {
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

    const draftItems = batchId ? await getDraftItems(batchId) : []
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
  } catch (error) {
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

async function getDraftItems(batchId: string): Promise<BotDraftSnapshotItem[]> {
  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    select: {
      pullRequests: {
        orderBy: { createAt: 'asc' },
        select: { id: true, action: true, word: true, code: true, type: true, weight: true, status: true, conflictReason: true },
      },
    },
  })

  return (batch?.pullRequests ?? []).map(pr => ({
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
