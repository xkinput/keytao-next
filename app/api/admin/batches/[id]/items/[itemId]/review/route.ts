import { NextResponse, type NextRequest } from 'next/server'
import { checkAdminPermission } from '@/lib/adminAuth'
import { BatchContentLockedError } from '@/lib/services/batchContentGuard'
import { ItemReviewError, recordItemReview } from '@/lib/services/batchItemReview'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const auth = await checkAdminPermission()
  if (!auth.authorized) return auth.response ?? NextResponse.json({ error: '权限不足' }, { status: 403 })
  if (!auth.session) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const { id, itemId } = await params
  const body = await request.json().catch(() => null)
  const decision = body?.decision
  const rawReason = body?.reason
  const reason = typeof rawReason === 'string' ? rawReason.trim() : ''
  const version = body?.expectedContentVersion
  if (!/^[1-9]\d*$/.test(itemId) || Number(itemId) > 2147483647 ||
      (decision !== 'Approved' && decision !== 'Rejected') ||
      !Number.isInteger(version) || version < 0 || version >= 2147483647) {
    return NextResponse.json({ error: '请提供有效的审核结果和批次版本' }, { status: 400 })
  }
  if ((rawReason !== undefined && typeof rawReason !== 'string') || reason.length > 2000) {
    return NextResponse.json({ error: '审核理由须为文字，最多 2000 字' }, { status: 400 })
  }
  if (decision === 'Rejected' && !reason) {
    return NextResponse.json({ error: '请填写拒绝理由' }, { status: 400 })
  }

  try {
    const item = await recordItemReview({
      batchId: id, itemId: Number(itemId), reviewerId: auth.session.id,
      decision, reason, expectedContentVersion: version,
    })
    return NextResponse.json({ item, contentVersion: version + 1 })
  } catch (error) {
    if (error instanceof BatchContentLockedError || error instanceof ItemReviewError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('Item review failed:', error)
    return NextResponse.json({ error: '词条审核失败' }, { status: 500 })
  }
}
