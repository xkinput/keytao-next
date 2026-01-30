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

    return NextResponse.json({ batch })
  } catch (error) {
    console.error('Get admin batch detail error:', error)
    return NextResponse.json({ error: '获取批次详情失败' }, { status: 500 })
  }
}
