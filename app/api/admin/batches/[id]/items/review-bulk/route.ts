import { NextResponse, type NextRequest } from 'next/server'
import { checkAdminPermission } from '@/lib/adminAuth'
import { BatchContentLockedError } from '@/lib/services/batchContentGuard'
import { IneligibleBulkReviewError, recordBulkItemApproval } from '@/lib/services/batchItemReview'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await checkAdminPermission()
  if (!auth.authorized) return auth.response ?? NextResponse.json({ error: '权限不足' }, { status: 403 })
  if (!auth.session) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const { id } = await params
  const body = await request.json().catch(() => null)
  const itemIds = body?.itemIds
  const version = body?.expectedContentVersion
  if (!Array.isArray(itemIds) || itemIds.length < 1 || itemIds.length > 500 ||
    itemIds.some(id => !Number.isInteger(id) || id < 1 || id > 2147483647) ||
    new Set(itemIds).size !== itemIds.length ||
    !Number.isInteger(version) || version < 0 || version >= 2147483647) {
    return NextResponse.json({ error: '请提供有效的词条 ID 和批次版本' }, { status: 400 })
  }

  try {
    const items = await recordBulkItemApproval({
      batchId: id, itemIds, reviewerId: auth.session.id, expectedContentVersion: version,
    })
    return NextResponse.json({ items, contentVersion: version + 1 })
  } catch (error) {
    if (error instanceof IneligibleBulkReviewError) {
      return NextResponse.json({ error: error.message, ineligibleIds: error.ineligibleIds }, { status: error.status })
    }
    if (error instanceof BatchContentLockedError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('Bulk item approval failed:', error)
    return NextResponse.json({ error: '批量放行失败' }, { status: 500 })
  }
}
