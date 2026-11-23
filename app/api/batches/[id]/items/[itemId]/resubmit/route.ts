import { NextResponse, type NextRequest } from 'next/server'
import { getSession } from '@/lib/auth'
import { BatchContentLockedError } from '@/lib/services/batchContentGuard'
import { ItemReviewError, resubmitRejectedItem } from '@/lib/services/batchItemReview'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const { id, itemId } = await params
  const body = await request.json().catch(() => null)
  const version = body?.expectedContentVersion
  if (!/^[1-9]\d*$/.test(itemId) || Number(itemId) > 2147483647 ||
      !Number.isInteger(version) || version < 0 || version >= 2147483647) {
    return NextResponse.json({ error: '词条编号或批次版本无效' }, { status: 400 })
  }

  try {
    await resubmitRejectedItem(id, Number(itemId), session.id, version)
    return NextResponse.json({ batchId: id, itemId: Number(itemId), contentVersion: version + 1 })
  } catch (error) {
    if (error instanceof BatchContentLockedError || error instanceof ItemReviewError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('Item resubmission failed:', error)
    return NextResponse.json({ error: '重新送审失败' }, { status: 500 })
  }
}
