import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireVerifiedBotUser } from '@/lib/botUserAuth'
import { lockBotDraftUser } from '@/lib/services/batchContentGuard'

/**
 * Bot API: Get or create latest draft batch
 * GET /api/bot/batches/latest-draft
 * Requires a valid Bot token and a bound platform user
 * 
 * Returns the user's latest Draft batch, or creates a new one if none exists
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const platform = searchParams.get('platform') as 'qq' | 'telegram' | null
    const platformId = searchParams.get('platformId')

    console.log('[Bot API] Get latest draft batch request:', {
      platform,
      platformId
    })

    const auth = await requireVerifiedBotUser(platform, platformId, { request, rawBody: '' })
    if (!auth.authorized) {
      return NextResponse.json(
        {
          success: false,
          message: auth.message
        },
        { status: auth.status }
      )
    }
    const user = auth.user

    // Find latest Draft batch for this user (bot-created only)
    // Bot-created batches have description starting with "键道助手"
    const { batch, isNew } = await prisma.$transaction(async (tx) => {
      await lockBotDraftUser(tx, user.id)
      const existing = await tx.batch.findFirst({
        where: {
          creatorId: user.id,
          status: 'Draft',
          description: { startsWith: '键道助手' },
        },
        orderBy: { createAt: 'desc' },
        select: {
          id: true,
          description: true,
          status: true,
          createAt: true,
          contentVersion: true,
          _count: {
            select: {
              pullRequests: true
            }
          }
        },
      })
      if (existing) return { batch: existing, isNew: false }
      const created = await tx.batch.create({
        data: { description: '键道助手草稿批次', creatorId: user.id, status: 'Draft' },
        select: {
          id: true, description: true, status: true, createAt: true, contentVersion: true,
          _count: { select: { pullRequests: true } },
        },
      })
      return { batch: created, isNew: true }
    })

    return NextResponse.json({
      success: true,
      batchId: batch.id,
      pullRequestCount: batch._count.pullRequests,
      contentVersion: batch.contentVersion,
      isNew,
      message: batch._count.pullRequests > 0
        ? `找到草稿批次，已包含 ${batch._count.pullRequests} 个修改`
        : '创建了新的草稿批次'
    })
  } catch (error) {
    console.error('[Bot API] Get latest draft batch error:', error)

    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2025') {
      return NextResponse.json(
        {
          success: false,
          message: '未找到绑定账号'
        },
        { status: 404 }
      )
    }

    const errorMessage = error instanceof Error ? error.message : '未知错误'
    return NextResponse.json(
      {
        success: false,
        message: `获取批次失败：${errorMessage}`
      },
      { status: 500 }
    )
  }
}
