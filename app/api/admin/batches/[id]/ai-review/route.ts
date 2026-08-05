import { NextRequest, NextResponse } from 'next/server'
import { checkAdminPermission } from '@/lib/adminAuth'
import { getAdminBatchReviewDetail } from '@/lib/services/adminBatchReviewDetailService'
import {
  requestMiaomiaoBatchReview,
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
    const prId = Number(body?.prId)
    const batch = await getAdminBatchReviewDetail(id)

    if (!batch) {
      return NextResponse.json({ error: '批次不存在' }, { status: 404 })
    }
    // Capture the content version the reviewer is about to look at. The remote
    // review can take minutes; binding the result to this version means a
    // content edit or status transition invalidates the verdict instead of
    // applying a result to a batch that has moved on.
    const reviewedContentVersion = batch.contentVersion

    const aiReview = await requestMiaomiaoBatchReview({
      batch,
      localReview: batch.aiReview,
      focusPrId: Number.isInteger(prId) ? prId : undefined,
    })

    await writeMiaomiaoBatchReview({
      batch,
      aiReview,
      expectedContentVersion: reviewedContentVersion,
    })

    const focusItem = Number.isInteger(prId)
      ? aiReview.items.find(item => item.prId === prId)
      : undefined

    return NextResponse.json({
      aiReview,
      focusItem,
      reviewedAt: aiReview.generatedAt,
    })
  } catch (error) {
    if (error instanceof StaleBatchReviewError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('Manual admin AI review error:', error)
    return NextResponse.json({ error: '喵喵复查失败' }, { status: 500 })
  }
}
