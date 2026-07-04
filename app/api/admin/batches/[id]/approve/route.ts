import { NextRequest, NextResponse } from 'next/server'
import { checkAdminPermission } from '@/lib/adminAuth'
import { approveSubmittedBatch } from '@/lib/services/batchApprovalService'

// POST /api/admin/batches/:id/approve - Approve a batch
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
    const body = await request.json()
    const { reviewNote } = body
    const result = await approveSubmittedBatch({
      batchId: id,
      reviewNote: reviewNote || null,
      mode: 'admin',
      allowDelete: true,
    })

    return NextResponse.json({ batch: result.batch })
  } catch (error) {
    console.error('Approve batch error:', error)
    const errorMessage = error instanceof Error ? error.message : '批准批次失败'
    const status = errorMessage === '批次不存在' ? 404
      : errorMessage === '只能审核待审核状态的批次' ? 400
        : 500
    return NextResponse.json({ error: '批准批次失败', details: errorMessage }, { status })
  }
}
