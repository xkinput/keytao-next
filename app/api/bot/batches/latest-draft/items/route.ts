import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireVerifiedBotUser } from '@/lib/botUserAuth'
import type { Prisma } from '@prisma/client'
import type { PhraseType } from '@/lib/constants/phraseTypes'
import { BOT_BATCH_DESCRIPTION_PREFIX, findCurrentBotDraftBatchId } from '@/lib/services/botDraftBatch'

/** Shape of the draft snapshot query, so item callbacks below stay typed. */
const DRAFT_BATCH_SELECT = {
  id: true,
  description: true,
  createAt: true,
  contentVersion: true,
  pullRequests: {
    orderBy: { createAt: 'asc' },
    select: {
      id: true,
      action: true,
      word: true,
      oldWord: true,
      code: true,
      type: true,
      remark: true,
      weight: true,
      status: true,
      createAt: true,
      conflictReason: true
    }
  }
} satisfies Prisma.BatchSelect

type DraftBatchSnapshot = Prisma.BatchGetPayload<{ select: typeof DRAFT_BATCH_SELECT }>
type DraftBatchItem = DraftBatchSnapshot['pullRequests'][number]

/**
 * Bot API: List all PR items in the user's current draft batch
 * GET /api/bot/batches/latest-draft/items
 * Requires a valid Bot token and a bound platform user
 *
 * Without an explicit `batchId` the batch is resolved through
 * `findCurrentBotDraftBatch`, the same selector `GET /latest-draft` uses, so
 * both endpoints can never disagree about which batch is "current".
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const platform = searchParams.get('platform') as 'qq' | 'telegram' | null
    const platformId = searchParams.get('platformId')
    const requestedBatchId = searchParams.get('batchId')

    const auth = await requireVerifiedBotUser(platform, platformId, { request, rawBody: '' })
    if (!auth.authorized) {
      return NextResponse.json({ success: false, message: auth.message }, { status: auth.status })
    }
    const user = auth.user

    const targetBatchId = requestedBatchId ?? await findCurrentBotDraftBatchId(prisma, user.id)

    const batch: DraftBatchSnapshot | null = targetBatchId
      ? await prisma.batch.findFirst({
        where: {
          id: targetBatchId,
          creatorId: user.id,
          status: requestedBatchId ? { in: ['Draft', 'Rejected'] } : 'Draft',
          description: { startsWith: BOT_BATCH_DESCRIPTION_PREFIX }
        },
        select: DRAFT_BATCH_SELECT
      })
      : null

    if (!batch) {
      // Same "no draft yet" CAS baseline as `GET /latest-draft`: callers that
      // build a plan digest can use (batchId: null, contentVersion: 0) and hand
      // it to a write without a batchId to create the first draft.
      return NextResponse.json({
        success: true,
        batchId: null,
        contentVersion: 0,
        items: [],
        message: '当前没有草稿批次'
      })
    }

    // Calculate dynamic weights and conflicts (same as web batch detail page)
    const { checkBatchConflictsWithWeight } = await import('@/lib/services/batchConflictService')
    const prItems = batch.pullRequests.map((pr: DraftBatchItem) => ({
      id: String(pr.id),
      action: pr.action as 'Create' | 'Change' | 'Delete',
      word: pr.word || '',
      oldWord: pr.oldWord || undefined,
      code: pr.code || '',
      type: (pr.type || 'Phrase') as PhraseType,
      weight: pr.weight ?? undefined,
    }))
    const conflictResults = prItems.length > 0 ? await checkBatchConflictsWithWeight(prItems) : []

    const enrichedItems = batch.pullRequests.map((pr: DraftBatchItem) => {
      const conflictResult = conflictResults.find(r => r.id === String(pr.id))
      return {
        ...pr,
        weight: conflictResult?.calculatedWeight ?? pr.weight,
        conflictInfo: conflictResult?.conflict ?? null,
      }
    })

    return NextResponse.json({
      success: true,
      batchId: batch.id,
      contentVersion: batch.contentVersion,
      items: enrichedItems,
      count: enrichedItems.length,
      message: enrichedItems.length > 0
        ? `草稿批次包含 ${enrichedItems.length} 个条目`
        : '草稿批次为空'
    })
  } catch (error) {
    console.error('[Bot API] List draft items error:', error)
    const errorMessage = error instanceof Error ? error.message : '未知错误'
    return NextResponse.json(
      { success: false, message: `获取失败：${errorMessage}` },
      { status: 500 }
    )
  }
}

/**
 * Bot API: Add a phrase to the user's latest draft batch (create if not exists)
 * POST /api/bot/batches/latest-draft/items
 * Body: { platform, platformId, word, code, type?, weight?, remark? }
 * Requires a valid Bot token and a bound platform user
 */
export async function POST(request: NextRequest) {
  // This legacy endpoint performed a direct write without a server preview
  // ticket and selected/created the batch before taking the per-user lock.
  // Keep it unavailable so every bot mutation goes through the transactional
  // `/api/bot/pull-requests/batch` preview-confirm flow.
  void request
  return NextResponse.json(
    { success: false, message: '此旧版直写接口已停用，请使用带确认票据的批量草稿接口' },
    { status: 410 }
  )
}
