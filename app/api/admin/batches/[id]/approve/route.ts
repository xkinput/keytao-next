import { NextRequest, NextResponse } from 'next/server'
import { checkAdminPermission } from '@/lib/adminAuth'
import { PhraseWeightConflictError } from '@/lib/services/phraseWeightLock'
import { ItemReviewError } from '@/lib/services/batchItemReview'
import {
  approveSubmittedBatch,
  BatchApprovalMissingPhraseError,
  BatchConcurrentUpdateError,
  BatchTargetMismatchError,
  BatchUnresolvableTargetError,
} from '@/lib/services/batchApprovalService'

export const maxDuration = 60

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
    const body = await request.json().catch(() => null)
    const version = body?.expectedContentVersion
    if (!Number.isInteger(version) || version < 0 || version >= 2147483647) {
      return NextResponse.json({ error: '请刷新并提交有效的批次版本' }, { status: 400 })
    }
    const result = await approveSubmittedBatch({
      batchId: id,
      mode: 'admin',
      allowDelete: true,
      reviewerId: authCheck.session?.id ?? null,
      expectedContentVersion: version,
      finalizeItemReview: true,
    })

    return NextResponse.json({ batch: result.batch })
  } catch (error) {
    if (error instanceof ItemReviewError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
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
