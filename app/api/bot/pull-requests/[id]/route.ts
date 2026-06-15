import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireVerifiedBotUser } from '@/lib/botUserAuth'
import { recheckBatchConflicts } from '@/lib/services/batchConflictService'

/**
 * Bot API: Delete a PR item from the user's draft batch
 * DELETE /api/bot/pull-requests/:id
 * Requires a valid Bot token and a bound platform user
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
    const { id } = await params
    const prId = parseInt(id, 10)

    if (isNaN(prId)) {
      return NextResponse.json({ success: false, message: '无效的 PR ID' }, { status: 400 })
    }

    const body = await request.json()
    const { platform, platformId } = body

    const auth = await requireVerifiedBotUser(platform, platformId)
    if (!auth.authorized) {
      return NextResponse.json({ success: false, message: auth.message }, { status: auth.status })
    }
    const user = auth.user

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

    // Re-check full batch conflict state so remaining items reflect the updated context
    await recheckBatchConflicts(pr.batch.id)

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
