import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireVerifiedBotUser } from '@/lib/botUserAuth'
import {
  approveSubmittedBatch,
  BatchApprovalTargetChangedError,
  BatchConcurrentUpdateError,
  classifyBatchDeleteRisk,
} from '@/lib/services/batchApprovalService'

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
    const rawBody = await request.clone().text()
    const body: unknown = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ success: false, message: '请求格式错误' }, { status: 400 })
    }
    const allowedKeys = new Set(['platform', 'platformId', 'reviewNote', 'expectedContentVersion'])
    if (Object.keys(body).some(key => !allowedKeys.has(key))) {
      return NextResponse.json({ success: false, message: '请求包含不支持的字段' }, { status: 400 })
    }
    const payload = body as Record<string, unknown>
    const { platform, platformId, reviewNote, expectedContentVersion } = payload
    if (
      typeof platform !== 'string'
      || typeof platformId !== 'string'
      || (reviewNote !== undefined && typeof reviewNote !== 'string')
      || !Number.isInteger(expectedContentVersion)
      || (expectedContentVersion as number) < 0
    ) {
      return NextResponse.json({ success: false, message: '请求字段类型错误' }, { status: 400 })
    }

    const auth = await requireVerifiedBotUser(platform, platformId, { request, rawBody })
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
          select: { action: true, word: true, code: true, needsManualReview: true },
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
    if (batch.contentVersion !== expectedContentVersion) {
      return NextResponse.json({ success: false, message: '批次内容已被修改，请刷新后重试' }, { status: 409 })
    }
    if (batch.pullRequests.some(item => item.needsManualReview)) {
      return NextResponse.json(
        { success: false, message: '批次包含必须人工审核的条目' },
        { status: 422 }
      )
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
      reviewNote: reviewNote || '本喵自动审词通过',
      mode: 'bot-auto',
      allowDelete: false,
      expectedContentVersion: expectedContentVersion as number,
    })

    return NextResponse.json({
      success: true,
      message: '批次已由本喵自动审核通过',
      batch: {
        id: result.batch.id,
        status: result.batch.status,
      },
    })
  } catch (error) {
    if (error instanceof BatchConcurrentUpdateError) {
      return NextResponse.json({ success: false, message: error.message }, { status: error.status })
    }
    if (error instanceof BatchApprovalTargetChangedError) {
      return NextResponse.json({ success: false, message: error.message }, { status: error.status })
    }
    console.error('[Bot API] Auto approve error:', error)
    const message = error instanceof Error ? error.message : '自动批准失败'
    return NextResponse.json(
      { success: false, message: `自动批准失败：${message}` },
      { status: getErrorStatus(message) }
    )
  }
}
