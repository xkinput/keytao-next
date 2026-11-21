import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { verifyApiKey } from '@/lib/apiKeyAuth'
import { withdrawBatchForUser } from '@/lib/services/batchWithdrawService'

// POST /api/batches/:id/withdraw - Withdraw a submitted batch (Bearer session or X-API-Key)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await getSession()
    let userId: number
    if (session) {
      userId = session.id
    } else if (request.headers.has('x-api-key')) {
      const auth = await verifyApiKey(request)
      if (!auth.success) return auth.response
      userId = auth.ctx.userId
    } else {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const result = await withdrawBatchForUser(id, userId)
    return NextResponse.json(result.body, { status: result.status })
  } catch (error) {
    console.error('Withdraw batch error:', error)
    return NextResponse.json({ error: '撤销批次失败' }, { status: 500 })
  }
}
