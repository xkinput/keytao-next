import { NextRequest, NextResponse } from 'next/server'
import { checkAdminPermission } from '@/lib/adminAuth'
import { getAdminBatchReviewDetail } from '@/lib/services/adminBatchReviewDetailService'
import { buildBatchAiReviewItems } from '@/lib/services/batchAiReviewService'

// GET /api/admin/batches/:id - Get batch detail for admin review
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authCheck = await checkAdminPermission()
    if (!authCheck.authorized) {
      return authCheck.response
    }

    const { id } = await params

    const batch = await getAdminBatchReviewDetail(id)

    if (!batch) {
      return NextResponse.json({ error: '批次不存在' }, { status: 404 })
    }

    const aiItems = await buildBatchAiReviewItems(batch.pullRequests)
    const aiItemsByPrId = new Map(aiItems.map(item => [item.prId, item]))
    return NextResponse.json({
      batch: {
        ...batch,
        pullRequests: batch.pullRequests.map(pr => ({ ...pr, aiReview: aiItemsByPrId.get(pr.id) })),
      },
    })
  } catch (error) {
    console.error('Get admin batch detail error:', error)
    return NextResponse.json({ error: '获取批次详情失败' }, { status: 500 })
  }
}
