import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const MAX_COMMENT_LENGTH = 2000

// POST create comment
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()

    if (!session) {
      return NextResponse.json(
        { error: '未登录' },
        { status: 401 }
      )
    }

    const { id } = await params
    const issueId = parseInt(id)

    if (!Number.isInteger(issueId) || issueId <= 0) {
      return NextResponse.json(
        { error: '无效的Issue ID' },
        { status: 400 }
      )
    }

    const body = await request.json()
    const { content } = body
    const normalizedContent = typeof content === 'string' ? content.trim() : ''

    if (!normalizedContent) {
      return NextResponse.json(
        { error: '评论内容不能为空' },
        { status: 400 }
      )
    }

    if (normalizedContent.length > MAX_COMMENT_LENGTH) {
      return NextResponse.json(
        { error: '评论内容过长' },
        { status: 400 }
      )
    }

    // Check if issue exists
    const issue = await prisma.issue.findUnique({
      where: { id: issueId }
    })

    if (!issue) {
      return NextResponse.json(
        { error: 'Issue不存在' },
        { status: 404 }
      )
    }

    const comment = await prisma.comment.create({
      data: {
        content: normalizedContent,
        issueId,
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

    return NextResponse.json({ comment })
  } catch (error) {
    console.error('Create comment error:', error)
    return NextResponse.json(
      { error: '创建评论失败' },
      { status: 500 }
    )
  }
}
