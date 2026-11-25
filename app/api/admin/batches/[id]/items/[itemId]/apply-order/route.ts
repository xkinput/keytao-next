import { NextResponse, type NextRequest } from 'next/server'
import { checkAdminPermission } from '@/lib/adminAuth'
import { BatchContentLockedError } from '@/lib/services/batchContentGuard'
import { ItemReviewError } from '@/lib/services/batchItemReview'
import { applySuggestedOrder } from '@/lib/services/suggestedOrderService'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const auth = await checkAdminPermission()
  if (!auth.authorized) return auth.response ?? NextResponse.json({ error: '权限不足' }, { status: 403 })
  if (!auth.session) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const { id, itemId } = await params
  const body = await request.json().catch(() => null)
  const { chainDigest, expectedContentVersion } = body ?? {}
  if (!/^[1-9]\d*$/.test(itemId) || Number(itemId) > 2147483647 ||
      typeof chainDigest !== 'string' || !/^[0-9a-f]{16}$/.test(chainDigest) ||
      !Number.isInteger(expectedContentVersion) || expectedContentVersion < 0 || expectedContentVersion >= 2147483647) {
    return NextResponse.json({ error: '请提供有效的编码链校验和批次版本' }, { status: 400 })
  }

  try {
    return NextResponse.json(await applySuggestedOrder({
      batchId: id, itemId: Number(itemId), chainDigest, expectedContentVersion,
    }))
  } catch (error) {
    if (error instanceof BatchContentLockedError || error instanceof ItemReviewError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('Applying suggested order failed:', error)
    return NextResponse.json({ error: '采纳喵喵排序失败' }, { status: 500 })
  }
}
