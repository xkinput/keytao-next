import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// GET /api/batches - List batches
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const status = searchParams.get('status')
    const page = parseInt(searchParams.get('page') || '1')
    const pageSize = parseInt(searchParams.get('pageSize') || '10')
    const onlyMine = searchParams.get('onlyMine') === 'true'
    const search = searchParams.get('search')

    const session = await getSession()

    const where: any = {}
    if (status) {
      where.status = status
    }
    if (onlyMine && session) {
      where.creatorId = session.id
    }
    if (search && search.trim()) {
      where.pullRequests = {
        some: {
          OR: [
            { word: { contains: search.trim(), mode: 'insensitive' } },
            { code: { contains: search.trim(), mode: 'insensitive' } }
          ]
        }
      }
    } else if (!onlyMine) {
      // Filter out batches with no pull requests in public list (when not searching)
      where.pullRequests = { some: {} }
    }

    const [batches, total] = await Promise.all([
      prisma.batch.findMany({
        where,
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
            take: 3,
            orderBy: { createAt: 'asc' },
            select: {
              id: true,
              status: true,
              hasConflict: true,
              action: true,
              code: true,
              word: true,
              oldWord: true
            }
          },
          _count: {
            select: {
              pullRequests: true
            }
          }
        },
        orderBy: { createAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      prisma.batch.count({ where })
    ])

    return NextResponse.json({
      batches,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize)
      }
    })
  } catch (error) {
    console.error('Get batches error:', error)
    return NextResponse.json({ error: '获取批次失败' }, { status: 500 })
  }
}

// POST /api/batches - Create a batch
export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const body = await request.json()
    const { description, issueId } = body

    const batch = await prisma.batch.create({
      data: {
        description,
        creatorId: session.id,
        issueId: issueId || undefined,
        status: 'Draft'
      },
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            nickname: true
          }
        }
      }
    })

    return NextResponse.json({ batch })
  } catch (error) {
    console.error('Create batch error:', error)
    return NextResponse.json({ error: '创建批次失败' }, { status: 500 })
  }
}
