import { NextRequest, NextResponse } from 'next/server'
import { checkAdminPermission } from '@/lib/adminAuth'
import { getAdminBatchReviewDetail } from '@/lib/services/adminBatchReviewDetailService'
import { buildMiaomiaoItemReviewContext } from '@/lib/services/batchAiReviewService'
import {
  requestMiaomiaoItemReview,
  StaleBatchReviewError,
  writeMiaomiaoBatchReview,
} from '@/lib/services/batchBotReviewService'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authCheck = await checkAdminPermission()
    if (!authCheck.authorized) {
      return authCheck.response
    }

    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const prId: unknown = body?.prId
    if (prId !== undefined && (typeof prId !== 'number' || !Number.isInteger(prId) || prId < 1 || prId > 2147483647)) {
      return NextResponse.json({ error: '词条 ID 无效' }, { status: 400 })
    }
    const batch = await getAdminBatchReviewDetail(id)

    if (!batch) {
      return NextResponse.json({ error: '批次不存在' }, { status: 404 })
    }
    if (batch.status === 'Approved') {
      return NextResponse.json({ error: '已通过的批次不能重新复审' }, { status: 409 })
    }
    const pullRequests = batch.pullRequests.filter(pr => !pr.appliedAt)
    const targets = prId === undefined ? pullRequests : pullRequests.filter(pr => pr.id === prId)
    if (!targets.length) {
      return NextResponse.json({ error: '未找到可复审的词条' }, { status: 404 })
    }
    // Capture the content version the reviewer is about to look at. The remote
    // review can take minutes; binding the result to this version means a
    // content edit or status transition invalidates the verdict instead of
    // applying a result to a batch that has moved on.
    const reviewedContentVersion = batch.contentVersion

    const aiReview = await requestMiaomiaoItemReview({
      batch: { id: batch.id, status: batch.status, description: batch.description, pullRequests },
      localReview: await buildMiaomiaoItemReviewContext(pullRequests),
      focusPrId: prId,
    })
    const reviewedIds = new Set(aiReview.items.map(item => item.prId))
    if (targets.some(pr => !reviewedIds.has(pr.id))) {
      return NextResponse.json({ error: '喵喵未返回完整的逐词复审结果' }, { status: 502 })
    }

    await writeMiaomiaoBatchReview({
      batch: { ...batch, pullRequests: targets },
      aiReview,
      expectedContentVersion: reviewedContentVersion,
    })

    return NextResponse.json({ reviewedAt: aiReview.generatedAt })
  } catch (error) {
    if (error instanceof StaleBatchReviewError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('Manual admin AI review error:', error)
    return NextResponse.json({ error: '喵喵复查失败' }, { status: 500 })
  }
}
