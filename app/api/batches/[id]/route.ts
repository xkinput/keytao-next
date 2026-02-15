import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// GET /api/batches/:id - Get batch details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const batch = await prisma.batch.findUnique({
      where: { id },
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            nickname: true
          }
        },
        sourceIssue: {
          select: {
            id: true,
            title: true,
            content: true
          }
        },
        pullRequests: {
          include: {
            phrase: true,
            dependencies: {
              include: {
                dependsOn: {
                  select: {
                    id: true,
                    word: true,
                    code: true
                  }
                }
              }
            },
            dependedBy: {
              include: {
                dependent: {
                  select: {
                    id: true,
                    word: true,
                    code: true
                  }
                }
              }
            },
            conflicts: true
          }
        }
      }
    })

    if (!batch) {
      return NextResponse.json({ error: '批次不存在' }, { status: 404 })
    }

    // Calculate dynamic weights and conflicts for all PRs in batch
    const { checkBatchConflictsWithWeight } = await import('@/lib/services/batchConflictService')

    const prItems = batch.pullRequests.map(pr => ({
      id: String(pr.id),
      action: pr.action as 'Create' | 'Change' | 'Delete',
      word: pr.word || '',
      oldWord: pr.oldWord || undefined,
      code: pr.code || '',
      type: pr.type || 'Phrase',
      weight: pr.weight || undefined,
    }))

    let conflictResults: any[] = []
    if (prItems.length > 0) {
      conflictResults = await checkBatchConflictsWithWeight(prItems)
    }

    // Enrich PRs with dynamic weight and conflict information
    const enrichedPRs = batch.pullRequests.map(pr => {
      const conflictResult = conflictResults.find(r => r.id === String(pr.id))
      return {
        ...pr,
        // Use calculated weight for display (for Create operations, this is the real weight)
        weight: conflictResult?.calculatedWeight ?? pr.weight,
        conflictInfo: conflictResult?.conflict,
      }
    })

    return NextResponse.json({
      batch: {
        ...batch,
        pullRequests: enrichedPRs
      }
    })
  } catch (error) {
    console.error('Get batch error:', error)
    return NextResponse.json({ error: '获取批次失败' }, { status: 500 })
  }
}

// PATCH /api/batches/:id - Update batch
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const batch = await prisma.batch.findUnique({
      where: { id }
    })

    if (!batch) {
      return NextResponse.json({ error: '批次不存在' }, { status: 404 })
    }

    if (batch.creatorId !== session.id) {
      return NextResponse.json({ error: '无权限' }, { status: 403 })
    }

    const body = await request.json()
    const { description } = body

    if (!description || typeof description !== 'string' || description.trim().length === 0) {
      return NextResponse.json({ error: '批次名称不能为空' }, { status: 400 })
    }

    const updated = await prisma.batch.update({
      where: { id },
      data: { description: description.trim() }
    })

    return NextResponse.json({ batch: updated })
  } catch (error) {
    console.error('Update batch error:', error)
    return NextResponse.json({ error: '更新批次失败' }, { status: 500 })
  }
}

// DELETE /api/batches/:id - Delete batch (draft only)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const batch = await prisma.batch.findUnique({
      where: { id }
    })

    if (!batch) {
      return NextResponse.json({ error: '批次不存在' }, { status: 404 })
    }

    if (batch.creatorId !== session.id) {
      return NextResponse.json({ error: '无权限' }, { status: 403 })
    }

    // Cannot delete Submitted or Approved batches
    if (batch.status === 'Submitted' || batch.status === 'Approved') {
      return NextResponse.json(
        { error: '不能删除审核中或已通过的批次' },
        { status: 400 }
      )
    }

    await prisma.batch.delete({
      where: { id }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete batch error:', error)
    return NextResponse.json({ error: '删除批次失败' }, { status: 500 })
  }
}
