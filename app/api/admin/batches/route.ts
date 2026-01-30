import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkAdminPermission } from '@/lib/adminAuth'

// GET /api/admin/batches - Get batches for admin review
export async function GET(request: NextRequest) {
  try {
    const authCheck = await checkAdminPermission()
    if (!authCheck.authorized) {
      return authCheck.response
    }

    const searchParams = request.nextUrl.searchParams
    const status = searchParams.get('status') || 'Submitted'

    const batches = await prisma.batch.findMany({
      where: {
        status: status as 'Draft' | 'Submitted' | 'Approved' | 'Rejected' | 'Published'
      },
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            nickname: true
          }
        },
        _count: {
          select: {
            pullRequests: true
          }
        }
      },
      orderBy: {
        createAt: 'desc'
      }
    })

    return NextResponse.json({ batches })
  } catch (error) {
    console.error('Get admin batches error:', error)
    return NextResponse.json({ error: '获取批次列表失败' }, { status: 500 })
  }
}
