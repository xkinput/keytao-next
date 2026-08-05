import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireVerifiedBotUser } from '@/lib/botUserAuth'
import { lockBotDraftUser } from '@/lib/services/batchContentGuard'
import { BOT_BATCH_DESCRIPTION_PREFIX } from '@/lib/services/botDraftBatch'

export async function GET(request: NextRequest) {
  try {
    const platform = request.nextUrl.searchParams.get('platform')
    const platformId = request.nextUrl.searchParams.get('platformId')
    const auth = await requireVerifiedBotUser(platform, platformId, { request, rawBody: '' })
    if (!auth.authorized) {
      return NextResponse.json({ success: false, message: auth.message }, { status: auth.status })
    }

    const batch = await prisma.batch.findFirst({
      where: {
        creatorId: auth.user.id,
        status: 'Submitted',
        description: { startsWith: BOT_BATCH_DESCRIPTION_PREFIX },
      },
      orderBy: { updateAt: 'desc' },
      select: {
        id: true,
        status: true,
        contentVersion: true,
        _count: { select: { pullRequests: true } },
      },
    })

    if (!batch) {
      return NextResponse.json({ success: false, message: '没有找到可撤回的提审批次' }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      batchId: batch.id,
      contentVersion: batch.contentVersion,
      status: batch.status,
      pullRequestCount: batch._count.pullRequests,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    return NextResponse.json({ success: false, message: `查询失败：${message}` }, { status: 500 })
  }
}

/**
 * Bot API: Recall (un-submit) the latest submitted batch, reverting it to Draft
 * POST /api/bot/batches/recall
 * Requires a valid Bot token and a bound platform user
 *
 * Automatically finds the most recent Submitted batch belonging to the caller
 * and sets it back to Draft status. Only works if batch is still Submitted
 * (not Approved or Rejected).
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.clone().text()
    const body: unknown = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ success: false, message: '请求格式错误' }, { status: 400 })
    }
    const allowedKeys = new Set(['platform', 'platformId', 'batchId', 'expectedContentVersion'])
    if (Object.keys(body).some(key => !allowedKeys.has(key))) {
      return NextResponse.json({ success: false, message: '请求包含不支持的字段' }, { status: 400 })
    }
    const payload = body as Record<string, unknown>
    const { platform, platformId, batchId, expectedContentVersion } = payload
    if (
      typeof platform !== 'string'
      || typeof platformId !== 'string'
      || typeof batchId !== 'string'
      || !batchId
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

    const recall = await prisma.$transaction(async (tx) => {
      await lockBotDraftUser(tx, user.id)
      // Serialize the cross-table invariant with every concurrent Batch/PR
      // writer, then re-check it inside the same transaction as the CAS.
      await tx.$executeRawUnsafe('LOCK TABLE "batches" IN SHARE ROW EXCLUSIVE MODE')
      await tx.$executeRawUnsafe('LOCK TABLE "pull_requests" IN SHARE ROW EXCLUSIVE MODE')

      const batch = await tx.batch.findFirst({
        where: {
          id: batchId,
          creatorId: user.id,
          status: 'Submitted',
          contentVersion: expectedContentVersion as number,
        },
        select: {
          id: true,
          contentVersion: true,
          _count: { select: { pullRequests: true } },
        },
      })
      if (!batch) return { kind: 'stale' as const }

      // Only a draft that actually holds content blocks a recall: after the
      // recall the restored batch owns the "current draft" pointer because the
      // selector prefers the draft with content (see botDraftBatch.ts).
      const existingDraft = await tx.batch.findFirst({
        where: {
          creatorId: user.id,
          status: 'Draft',
          description: { startsWith: BOT_BATCH_DESCRIPTION_PREFIX },
          pullRequests: { some: {} },
        },
        select: { id: true },
      })
      if (existingDraft) return { kind: 'draft-exists' as const }

      const updated = await tx.batch.updateMany({
        where: {
          id: batch.id,
          creatorId: user.id,
          status: 'Submitted',
          contentVersion: expectedContentVersion as number,
        },
        data: { status: 'Draft' },
      })
      if (updated.count !== 1) return { kind: 'stale' as const }
      return { kind: 'ok' as const, batch }
    })

    if (recall.kind === 'draft-exists') {
      return NextResponse.json(
        { success: false, message: '当前草稿批次已有内容，无法撤回之前的提交。请先清空或提交当前草稿。' },
        { status: 400 }
      )
    }
    if (recall.kind !== 'ok') {
      return NextResponse.json(
        { success: false, message: '批次内容或状态已变化，请刷新后重试' },
        { status: 409 }
      )
    }

    return NextResponse.json({
      success: true,
      message: `已撤回提审，批次重新变为草稿状态（共 ${recall.batch._count.pullRequests} 条）`,
      batchId: recall.batch.id,
      contentVersion: recall.batch.contentVersion,
      status: 'Draft',
    })
  } catch (error: unknown) {
    console.error('[Bot API] recall error:', error)
    const msg = error instanceof Error ? error.message : '未知错误'
    return NextResponse.json({ success: false, message: `撤回失败：${msg}` }, { status: 500 })
  }
}
