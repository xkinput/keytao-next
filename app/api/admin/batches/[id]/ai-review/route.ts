import { NextRequest, NextResponse } from 'next/server'
import { checkAdminPermission } from '@/lib/adminAuth'
import { getAdminBatchReviewDetail } from '@/lib/services/adminBatchReviewDetailService'

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

    const focusItem = Number.isInteger(prId)
      ? batch.aiReview.items.find(item => item.prId === prId)
      : undefined

    return NextResponse.json({
      aiReview: batch.aiReview,
      focusItem,
      reviewedAt: batch.aiReview.generatedAt,
    })
  } catch (error) {
    console.error('Manual admin AI review error:', error)
    return NextResponse.json({ error: '喵喵复查失败' }, { status: 500 })
  }
}
