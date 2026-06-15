import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireVerifiedBotUser } from '@/lib/botUserAuth'

/**
 * Bot API: Recall (un-submit) the latest submitted batch, reverting it to Draft
 * POST /api/bot/batches/recall
 * Requires Bot token plus a matching user JWT or API key
 *
 * Automatically finds the most recent Submitted batch belonging to the caller
 * and sets it back to Draft status. Only works if batch is still Submitted
 * (not Approved or Rejected).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { platform, platformId } = body

    if (!platform || !platformId) {
      return NextResponse.json({ success: false, message: '缺少必需参数' }, { status: 400 })
    }

    const auth = await requireVerifiedBotUser(platform, platformId)
    if (!auth.authorized) {
      return NextResponse.json(
        { success: false, message: auth.message },
        { status: auth.status }
      )
    }
    const user = auth.user

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

    // Block recall if there's already a draft batch with content
    const existingDraft = await prisma.batch.findFirst({
      where: {
        creatorId: user.id,
        status: 'Draft',
        description: { startsWith: '键道助手' },
        pullRequests: { some: {} },
      },
      select: { id: true },
    })

    if (existingDraft) {
      return NextResponse.json(
        { success: false, message: '当前草稿批次已有内容，无法撤回之前的提交。请先清空或提交当前草稿。' },
        { status: 400 }
      )
    }

    // Delete the empty draft batch (if any) before reverting the submitted one
    await prisma.batch.deleteMany({
      where: {
        creatorId: user.id,
        status: 'Draft',
        description: { startsWith: '键道助手' },
        pullRequests: { none: {} },
      },
    })

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
