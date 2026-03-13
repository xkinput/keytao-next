import { NextRequest, NextResponse } from 'next/server'
import { verifyBotToken } from '@/lib/botAuth'
import { prisma } from '@/lib/prisma'

/**
 * Bot API: Recall (un-submit) the latest submitted batch, reverting it to Draft
 * POST /api/bot/batches/recall
 *
 * Automatically finds the most recent Submitted batch belonging to the caller
 * and sets it back to Draft status. Only works if batch is still Submitted
 * (not Approved or Rejected).
 */
export async function POST(request: NextRequest) {
  try {
    if (!await verifyBotToken()) {
      return NextResponse.json({ success: false, message: '未授权' }, { status: 401 })
    }

    const body = await request.json()
    const { platform, platformId } = body

    if (!platform || !platformId) {
      return NextResponse.json({ success: false, message: '缺少必需参数' }, { status: 400 })
    }

    if (!['qq', 'telegram'].includes(platform)) {
      return NextResponse.json({ success: false, message: '不支持的平台' }, { status: 400 })
    }

    const fieldName = platform === 'qq' ? 'qqId' : 'telegramId'
    const user = await prisma.user.findFirst({
      where: { [fieldName]: platformId, status: 'ENABLE' },
      select: { id: true },
    })

    if (!user) {
      return NextResponse.json(
        { success: false, message: '未找到绑定账号，请先使用 /bind 命令绑定' },
        { status: 404 }
      )
    }

    // Find the most recent Submitted batch belonging to this user
    const batch = await prisma.batch.findFirst({
      where: {
        creatorId: user.id,
        status: 'Submitted',
        description: { startsWith: '键道助手' },
      },
      orderBy: { updateAt: 'desc' },
      select: {
        id: true,
        status: true,
        description: true,
        _count: { select: { pullRequests: true } },
      },
    })

    if (!batch) {
      return NextResponse.json(
        { success: false, message: '没有找到可撤回的提审批次（只有"审核中"状态的批次可以撤回）' },
        { status: 404 }
      )
    }

    // Revert to Draft
    const updated = await prisma.batch.update({
      where: { id: batch.id },
      data: { status: 'Draft' },
      select: { id: true, status: true },
    })

    return NextResponse.json({
      success: true,
      message: `已撤回提审，批次重新变为草稿状态（共 ${batch._count.pullRequests} 条）`,
      batchId: updated.id,
      status: updated.status,
    })
  } catch (error: unknown) {
    console.error('[Bot API] recall error:', error)
    const msg = error instanceof Error ? error.message : '未知错误'
    return NextResponse.json({ success: false, message: `撤回失败：${msg}` }, { status: 500 })
  }
}
