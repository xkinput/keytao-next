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

    return NextResponse.json({ batch })
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

    if (batch.status !== 'Draft') {
      return NextResponse.json(
        { error: '只能删除草稿状态的批次' },
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
