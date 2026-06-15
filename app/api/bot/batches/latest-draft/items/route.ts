import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireVerifiedBotUser } from '@/lib/botUserAuth'
import type { PhraseType } from '@/lib/constants/phraseTypes'

/**
 * Bot API: List all PR items in the user's latest draft batch
 * GET /api/bot/batches/latest-draft/items
 * Requires Bot token plus a matching user JWT or API key
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const platform = searchParams.get('platform') as 'qq' | 'telegram' | null
    const platformId = searchParams.get('platformId')

    if (!platform || !platformId) {
      return NextResponse.json({ success: false, message: '缺少必需参数' }, { status: 400 })
    }

    const auth = await requireVerifiedBotUser(platform, platformId)
    if (!auth.authorized) {
      return NextResponse.json({ success: false, message: auth.message }, { status: auth.status })
    }
    const user = auth.user

    const batch = await prisma.batch.findFirst({
      where: {
        creatorId: user.id,
        status: 'Draft',
        description: { startsWith: '键道助手' }
      },
      orderBy: { createAt: 'desc' },
      select: {
        id: true,
        description: true,
        createAt: true,
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
      }
    })

    if (!batch) {
      return NextResponse.json({
        success: true,
        batchId: null,
        items: [],
        message: '当前没有草稿批次'
      })
    }

    // Calculate dynamic weights and conflicts (same as web batch detail page)
    const { checkBatchConflictsWithWeight } = await import('@/lib/services/batchConflictService')
    const prItems = batch.pullRequests.map(pr => ({
      id: String(pr.id),
      action: pr.action as 'Create' | 'Change' | 'Delete',
      word: pr.word || '',
      oldWord: pr.oldWord || undefined,
      code: pr.code || '',
      type: (pr.type || 'Phrase') as PhraseType,
      weight: pr.weight ?? undefined,
    }))
    const conflictResults = prItems.length > 0 ? await checkBatchConflictsWithWeight(prItems) : []

    const enrichedItems = batch.pullRequests.map(pr => {
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
 * Requires Bot token plus a matching user JWT or API key
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { platform, platformId, word, code, type = 'Phrase', weight, remark } = body
    const parsedWeight = weight === undefined || weight === null || weight === ''
      ? undefined
      : Number(weight)

    if (!platform || !platformId || !word || !code) {
      return NextResponse.json({ success: false, message: '缺少必需参数: platform, platformId, word, code' }, { status: 400 })
    }

    if (parsedWeight !== undefined && (!Number.isInteger(parsedWeight) || parsedWeight < 0)) {
      return NextResponse.json({ success: false, message: '权重必须是非负整数' }, { status: 400 })
    }

    const auth = await requireVerifiedBotUser(platform, platformId)
    if (!auth.authorized) {
      return NextResponse.json({ success: false, message: auth.message }, { status: auth.status })
    }
    const user = auth.user

    // Find or create draft batch
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

    // Add PR to batch
    const pr = await prisma.pullRequest.create({
      data: {
        word,
        code,
        action: 'Create',
        type: type as PhraseType,
        weight: parsedWeight,
        remark: remark || null,
        batchId: batch.id,
        userId: user.id,
      },
      select: { id: true, word: true, code: true, type: true, weight: true }
    })

    return NextResponse.json({
      success: true,
      batchId: batch.id,
      item: pr,
      message: `已将「${word}」(${code}) 添加到草稿批次`
    })
  } catch (error) {
    console.error('[Bot API] Add draft item error:', error)
    const errorMessage = error instanceof Error ? error.message : '未知错误'
    return NextResponse.json(
      { success: false, message: `添加失败：${errorMessage}` },
      { status: 500 }
    )
  }
}
