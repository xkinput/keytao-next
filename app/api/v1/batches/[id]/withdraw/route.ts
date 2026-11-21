import { NextRequest, NextResponse } from 'next/server'
import { verifyApiKey } from '@/lib/apiKeyAuth'
import { withdrawBatchForUser } from '@/lib/services/batchWithdrawService'

// POST /api/v1/batches/:id/withdraw - Withdraw a submitted batch via API key
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await verifyApiKey(request)
    if (!auth.success) return auth.response

    const { id } = await params
    const result = await withdrawBatchForUser(id, auth.ctx.userId)
    return NextResponse.json(result.body, { status: result.status })
  } catch (error) {
    console.error('[API v1] Withdraw batch error:', error)
    return NextResponse.json({ error: '撤销批次失败' }, { status: 500 })
  }
}
