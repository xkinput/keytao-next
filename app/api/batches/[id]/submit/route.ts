import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { verifyApiKey } from '@/lib/apiKeyAuth'
import { submitBatchForUser } from '@/lib/services/batchSubmitService'

export const maxDuration = 30

// POST /api/batches/:id/submit - Submit batch for review (Bearer session or X-API-Key)
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
      const apiKeyAuth = await verifyApiKey(request)
      if (!apiKeyAuth.success) return apiKeyAuth.response
      userId = apiKeyAuth.ctx.userId
    } else {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const rawBody = await request.json().catch(() => ({}))
    const result = await submitBatchForUser({
      batchId: id,
      userId,
      rawBody,
    })

    return NextResponse.json(result.body, { status: result.status })
  } catch (error) {
    console.error('Submit batch error:', error)
    return NextResponse.json({ error: '提交批次失败' }, { status: 500 })
  }
}
