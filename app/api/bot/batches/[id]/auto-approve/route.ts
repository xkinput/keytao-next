import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireVerifiedBotUser } from '@/lib/botUserAuth'
import { approveSubmittedBatch, classifyBatchDeleteRisk } from '@/lib/services/batchApprovalService'

function getErrorStatus(message: string): number {
  if (message === '批次不存在') return 404
  if (message === '只能审核待审核状态的批次') return 400
  if (message.startsWith('自动审核禁止纯删除项')) return 400
  return 500
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { platform, platformId, reviewNote } = body

    const auth = await requireVerifiedBotUser(platform, platformId)
    if (!auth.authorized) {
      return NextResponse.json(
        { success: false, message: auth.message },
        { status: auth.status }
      )
    }
    const user = auth.user

    const batch = await prisma.batch.findUnique({
      where: { id },
      include: {
        pullRequests: {
          orderBy: { createAt: 'asc' },
          select: { action: true, word: true, code: true },
        },
      },
    })

    if (!batch) {
      return NextResponse.json({ success: false, message: '批次不存在' }, { status: 404 })
    }
    if (batch.creatorId !== user.id) {
      return NextResponse.json({ success: false, message: '无权限操作此批次' }, { status: 403 })
    }
    if (batch.status !== 'Submitted') {
      return NextResponse.json({ success: false, message: '只能自动批准已提交审核的批次' }, { status: 400 })
    }

    const deleteRisk = classifyBatchDeleteRisk(batch.pullRequests)
    if (deleteRisk.hasBareDelete) {
      return NextResponse.json({
        success: false,
        message: '自动审核禁止纯删除项，已保留给管理员审核',
        bareDeletes: deleteRisk.bareDeletes,
      }, { status: 400 })
    }

    const result = await approveSubmittedBatch({
      batchId: id,
      reviewNote: reviewNote || 'Bot 自动审词通过',
      mode: 'bot-auto',
      allowDelete: false,
    })

    return NextResponse.json({
      success: true,
      message: '批次已由 Bot 自动审核通过',
      batch: {
        id: result.batch.id,
        status: result.batch.status,
      },
    })
  } catch (error) {
    console.error('[Bot API] Auto approve error:', error)
    const message = error instanceof Error ? error.message : '自动批准失败'
    return NextResponse.json(
      { success: false, message: `自动批准失败：${message}` },
      { status: getErrorStatus(message) }
    )
  }
}
