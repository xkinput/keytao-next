import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkAdminPermission } from '@/lib/adminAuth'
import { BatchConcurrentUpdateError } from '@/lib/services/batchApprovalService'

// POST /api/admin/batches/:id/reject - Reject a batch
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

    if (!reviewNote?.trim()) {
      return NextResponse.json(
        { error: '拒绝时必须填写审核意见' },
        { status: 400 }
      )
    }

    const batch = await prisma.batch.findUnique({
      where: { id },
      include: {
        pullRequests: {
          orderBy: {
            createAt: 'asc'
          }
        }
      }
    })

    if (!batch) {
      return NextResponse.json({ error: '批次不存在' }, { status: 404 })
    }

    if (batch.status !== 'Submitted') {
      return NextResponse.json(
        { error: '只能审核待审核状态的批次' },
        { status: 400 }
      )
    }

    // Update batch and all PRs in a transaction
    const result = await prisma.$transaction(async (tx) => {
      const transitioned = await tx.batch.updateMany({
        where: {
          id,
          status: 'Submitted',
          contentVersion: batch.contentVersion,
        },
        data: {
          status: 'Rejected',
          reviewNote,
        },
      })
      if (transitioned.count !== 1) {
        throw new BatchConcurrentUpdateError()
      }

      // Update all PRs to Rejected status
      await tx.pullRequest.updateMany({
        where: {
          batchId: id
        },
        data: {
          status: 'Rejected'
        }
      })

      return tx.batch.findUniqueOrThrow({
        where: { id },
      })
    })

    return NextResponse.json({ batch: result })
  } catch (error) {
    if (error instanceof BatchConcurrentUpdateError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('Reject batch error:', error)
    const errorMessage = error instanceof Error ? error.message : '拒绝批次失败'
    return NextResponse.json({ error: '拒绝批次失败', details: errorMessage }, { status: 500 })
  }
}
