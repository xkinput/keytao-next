import { NextRequest, NextResponse } from 'next/server'
import { verifyBotToken } from '@/lib/botAuth'
import { prisma } from '@/lib/prisma'

/**
 * Bot API: List all PR items in the user's latest draft batch
 * GET /api/bot/batches/latest-draft/items
 * Requires Bot token authentication
 */
export async function GET(request: NextRequest) {
  try {
    if (!await verifyBotToken()) {
      return NextResponse.json({ success: false, message: '未授权' }, { status: 401 })
    }

    const searchParams = request.nextUrl.searchParams
    const platform = searchParams.get('platform') as 'qq' | 'telegram' | null
    const platformId = searchParams.get('platformId')

    if (!platform || !platformId) {
      return NextResponse.json({ success: false, message: '缺少必需参数' }, { status: 400 })
    }

    if (!['qq', 'telegram'].includes(platform)) {
      return NextResponse.json({ success: false, message: '不支持的平台' }, { status: 400 })
    }

    const fieldName = platform === 'qq' ? 'qqId' : 'telegramId'

    const user = await prisma.user.findFirst({
      where: { [fieldName]: platformId, status: 'ENABLE' },
      select: { id: true }
    })

    if (!user) {
      return NextResponse.json(
        { success: false, message: '未找到绑定账号，请先使用 /bind 命令绑定' },
        { status: 404 }
      )
    }

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
            createAt: true
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

    return NextResponse.json({
      success: true,
      batchId: batch.id,
      items: batch.pullRequests,
      count: batch.pullRequests.length,
      message: batch.pullRequests.length > 0
        ? `草稿批次包含 ${batch.pullRequests.length} 个条目`
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
