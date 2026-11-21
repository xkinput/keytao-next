import { NextRequest, NextResponse } from 'next/server'
import { verifyApiKey } from '@/lib/apiKeyAuth'
import { submitBatchForUser } from '@/lib/services/batchSubmitService'

export const maxDuration = 30

// POST /api/v1/batches/:id/submit - Submit a draft or rejected batch via API key
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await verifyApiKey(request)
    if (!auth.success) return auth.response

    const { id } = await params
    const rawBody = await request.json().catch(() => ({}))
    const result = await submitBatchForUser({
      batchId: id,
      userId: auth.ctx.userId,
      rawBody,
    })

    return NextResponse.json(result.body, { status: result.status })
  } catch (error) {
    console.error('[API v1] Submit batch error:', error)
    return NextResponse.json({ error: '提交批次失败' }, { status: 500 })
  }
}
