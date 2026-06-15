import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { BatchStatus, Prisma } from '@prisma/client'

// GET /api/batches - List batches
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const status = searchParams.get('status')
    const rawPage = parseInt(searchParams.get('page') || '1', 10)
    const rawPageSize = parseInt(searchParams.get('pageSize') || '10', 10)
    const page = Number.isFinite(rawPage) ? Math.min(100, Math.max(1, rawPage)) : 1
    const pageSize = Number.isFinite(rawPageSize) ? Math.min(100, Math.max(1, rawPageSize)) : 10
    const onlyMine = searchParams.get('onlyMine') === 'true'
    const search = searchParams.get('search')?.trim() || ''

    const session = await getSession()

    const where: Prisma.BatchWhereInput = {}
    if (status && Object.values(BatchStatus).includes(status as BatchStatus)) {
      where.status = status as BatchStatus
    }
    if (onlyMine && !session) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }
    if (onlyMine && session) {
      where.creatorId = session.id
    }
    if (search.length > 50) {
      return NextResponse.json({ error: '搜索参数过长' }, { status: 400 })
    }
    if (search) {
      where.pullRequests = {
        some: {
          OR: [
            { word: { contains: search, mode: 'insensitive' } },
            { code: { contains: search, mode: 'insensitive' } }
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
    const normalizedDescription = typeof description === 'string' ? description.trim() : ''

    if (normalizedDescription.length > 200) {
      return NextResponse.json({ error: '批次描述过长' }, { status: 400 })
    }

    if (issueId !== undefined && (!Number.isInteger(issueId) || issueId <= 0)) {
      return NextResponse.json({ error: 'Issue ID 无效' }, { status: 400 })
    }

    const batch = await prisma.batch.create({
      data: {
        description: normalizedDescription || undefined,
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
