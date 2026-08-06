import { NextRequest, NextResponse } from 'next/server'
import { checkAdminPermission } from '@/lib/adminAuth'
import { PhraseWeightConflictError } from '@/lib/services/phraseWeightLock'
import {
  approveSubmittedBatch,
  BatchApprovalMissingPhraseError,
  BatchConcurrentUpdateError,
  BatchTargetMismatchError,
  BatchUnresolvableTargetError,
} from '@/lib/services/batchApprovalService'

export const maxDuration = 30

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
      reviewerId: authCheck.session?.id ?? null,
    })

    return NextResponse.json({ batch: result.batch })
  } catch (error) {
    console.error('Approve batch error:', error)

    if (error instanceof BatchConcurrentUpdateError) {
      return NextResponse.json({ error: '批准批次失败', details: error.message }, { status: 409 })
    }
    if (error instanceof BatchUnresolvableTargetError) {
      return NextResponse.json(
        { error: '批准批次失败', details: error.message, unresolvable: error.items },
        { status: error.status }
      )
    }
    if (error instanceof PhraseWeightConflictError) {
      return NextResponse.json(
        { error: '批准批次失败', details: error.message, weightCollisions: error.collisions },
        { status: error.status }
      )
    }
    if (error instanceof BatchTargetMismatchError) {
      return NextResponse.json(
        { error: '批准批次失败', details: error.message, mismatches: error.mismatches },
        { status: error.status }
      )
    }
    if (error instanceof BatchApprovalMissingPhraseError) {
      return NextResponse.json(
        { error: '批准批次失败', details: error.message, missing: error.missing },
        { status: 400 }
      )
    }

    const errorMessage = error instanceof Error ? error.message : '批准批次失败'
    const status = errorMessage === '批次不存在' ? 404
      : errorMessage === '只能审核待审核状态的批次' ? 400
        : 500
    return NextResponse.json({ error: '批准批次失败', details: errorMessage }, { status })
  }
}
