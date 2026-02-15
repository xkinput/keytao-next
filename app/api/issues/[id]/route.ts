import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// GET single issue with comments
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const issueId = parseInt(id)

    if (isNaN(issueId)) {
      return NextResponse.json(
        { error: '无效的Issue ID' },
        { status: 400 }
      )
    }

    const issue = await prisma.issue.findUnique({
      where: { id: issueId },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            nickname: true
          }
        },
        comments: {
          include: {
            author: {
              select: {
                id: true,
                name: true,
                nickname: true
              }
            }
          },
          orderBy: { createAt: 'asc' }
        },
        batches: {
          select: {
            id: true,
            description: true,
            status: true,
            createAt: true
          }
        }
      }
    })

    if (!issue) {
      return NextResponse.json(
        { error: 'Issue不存在' },
        { status: 404 }
      )
    }

    return NextResponse.json({ issue })
  } catch (error) {
    console.error('Get issue error:', error)
    return NextResponse.json(
      { error: '获取Issue失败' },
      { status: 500 }
    )
  }
}

// PATCH update issue status
export async function PATCH(
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

    if (isNaN(issueId)) {
      return NextResponse.json(
        { error: '无效的Issue ID' },
        { status: 400 }
      )
    }

    const body = await request.json()
    const { status } = body

    if (typeof status !== 'boolean') {
      return NextResponse.json(
        { error: '状态必须是布尔值' },
        { status: 400 }
      )
    }

    const issue = await prisma.issue.findUnique({
      where: { id: issueId }
    })

    if (!issue) {
      return NextResponse.json(
        { error: 'Issue不存在' },
        { status: 404 }
      )
    }

    // Only author can update status
    if (issue.authorId !== session.id) {
      return NextResponse.json(
        { error: '只有作者可以修改状态' },
        { status: 403 }
      )
    }

    const updatedIssue = await prisma.issue.update({
      where: { id: issueId },
      data: { status },
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

    return NextResponse.json({ issue: updatedIssue })
  } catch (error) {
    console.error('Update issue error:', error)
    return NextResponse.json(
      { error: '更新Issue失败' },
      { status: 500 }
    )
  }
}
