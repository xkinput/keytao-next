import { NextRequest, NextResponse } from 'next/server'
import { verifyBotToken } from '@/lib/botAuth'
import { prisma } from '@/lib/prisma'

/**
 * Bot API: Delete a PR item from the user's draft batch
 * DELETE /api/bot/pull-requests/:id
 * Requires Bot token authentication
 *
 * Only allows deletion if:
 * - The PR belongs to the caller's batch
 * - The batch is in Draft status
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!await verifyBotToken()) {
      return NextResponse.json({ success: false, message: '未授权' }, { status: 401 })
    }

    const { id } = await params
    const prId = parseInt(id, 10)

    if (isNaN(prId)) {
      return NextResponse.json({ success: false, message: '无效的 PR ID' }, { status: 400 })
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
      select: { id: true }
    })

    if (!user) {
      return NextResponse.json(
        { success: false, message: '未找到绑定账号，请先使用 /bind 命令绑定' },
        { status: 404 }
      )
    }

    // Fetch PR and its batch in one query to verify ownership
    const pr = await prisma.pullRequest.findUnique({
      where: { id: prId },
      select: {
        id: true,
        word: true,
        code: true,
        action: true,
        userId: true,
        batch: {
          select: { id: true, status: true, creatorId: true }
        }
      }
    })

    if (!pr) {
      return NextResponse.json({ success: false, message: 'PR 条目不存在' }, { status: 404 })
    }

    // Verify ownership
    if (pr.userId !== user.id) {
      return NextResponse.json({ success: false, message: '无权限操作此条目' }, { status: 403 })
    }

    // Only allow deletion from Draft batches
    if (!pr.batch || pr.batch.status !== 'Draft') {
      return NextResponse.json(
        { success: false, message: '只能删除草稿批次中的条目' },
        { status: 400 }
      )
    }

    await prisma.pullRequest.delete({ where: { id: prId } })

    console.log(`[Bot API] Deleted PR #${prId} (${pr.action} "${pr.word}") from batch ${pr.batch.id}`)

    return NextResponse.json({
      success: true,
      message: `已删除条目：${pr.action} "${pr.word}"（编码：${pr.code}）`
    })
  } catch (error) {
    console.error('[Bot API] Delete PR error:', error)
    const errorMessage = error instanceof Error ? error.message : '未知错误'
    return NextResponse.json(
      { success: false, message: `删除失败：${errorMessage}` },
      { status: 500 }
    )
  }
}
