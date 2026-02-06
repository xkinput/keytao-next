import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkAdminPermission } from '@/lib/adminAuth'

// GET /api/admin/batches/:id - Get batch detail for admin review
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authCheck = await checkAdminPermission()
    if (!authCheck.authorized) {
      return authCheck.response
    }

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
            title: true
          }
        },
        pullRequests: {
          include: {
            phrase: true,
            conflicts: true,
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
            }
          },
          orderBy: {
            createAt: 'asc'
          }
        }
      }
    })

    if (!batch) {
      return NextResponse.json({ error: '批次不存在' }, { status: 404 })
    }

    // Calculate dynamic weights and conflicts for all PRs in batch
    const { checkBatchConflictsWithWeight } = await import('@/lib/services/batchConflictService')
    const prItems = batch.pullRequests
      .filter(pr => pr.word && pr.code)
      .map(pr => ({
        id: String(pr.id),
        action: pr.action as 'Create' | 'Change' | 'Delete',
        word: pr.word!,
        code: pr.code!,
        oldWord: pr.oldWord || undefined,
        weight: pr.weight || undefined,
        type: pr.type || 'Phrase',
      }))
    const conflictResults = await checkBatchConflictsWithWeight(prItems)

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
    console.error('Get admin batch detail error:', error)
    return NextResponse.json({ error: '获取批次详情失败' }, { status: 500 })
  }
}
