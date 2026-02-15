import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const page = parseInt(searchParams.get('page') || '1')
    const pageSize = parseInt(searchParams.get('pageSize') || '10')
    const status = searchParams.get('status')

    const where = status ? { status: status as any } : {}

    const [issues, total] = await Promise.all([
      prisma.issue.findMany({
        where,
        include: {
          author: {
            select: {
              id: true,
              name: true,
              nickname: true
            }
          },
          comments: {
            select: {
              id: true
            }
          }
        },
        orderBy: { createAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      prisma.issue.count({ where })
    ])

    // Transform to add comment count
    const issuesWithCount = issues.map(issue => ({
      ...issue,
      _count: {
        comments: issue.comments.length
      },
      comments: undefined // Remove comments from response
    }))

    return NextResponse.json({
      issues: issuesWithCount,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize)
      }
    })
  } catch (error) {
    console.error('Get issues error:', error)
    return NextResponse.json(
      { error: '获取 issues 失败' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()

    if (!session) {
      return NextResponse.json(
        { error: '未登录' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { title, content } = body

    if (!title || !content) {
      return NextResponse.json(
        { error: '标题和内容不能为空' },
        { status: 400 }
      )
    }

    const issue = await prisma.issue.create({
      data: {
        title,
        content,
        status: true, // true = 开放, false = 已关闭
        authorId: session.id
      },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            nickname: true
          }
        }
      }
    })

    return NextResponse.json({ issue })
  } catch (error) {
    console.error('Create issue error:', error)
    return NextResponse.json(
      { error: '创建 issue 失败' },
      { status: 500 }
    )
  }
}
