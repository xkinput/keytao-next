import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { conflictDetector } from '@/lib/services/conflictDetector'
import { PullRequestType } from '@prisma/client'

// GET /api/pull-requests/:id - Get PR with dependencies
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const pr = await prisma.pullRequest.findUnique({
      where: { id: parseInt(id) },
      include: {
        phrase: true,
        batch: {
          include: {
            sourceIssue: {
              select: {
                id: true,
                title: true
              }
            }
          }
        },
        user: {
          select: {
            id: true,
            name: true,
            nickname: true
          }
        },
        conflicts: true,
        dependencies: {
          include: {
            dependsOn: {
              select: {
                id: true,
                word: true,
                code: true,
                action: true
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
                code: true,
                action: true
              }
            }
          }
        },
        likedBy: {
          select: {
            id: true,
            name: true,
            nickname: true
          }
        },
        dislikedBy: {
          select: {
            id: true,
            name: true,
            nickname: true
          }
        }
      }
    })

    if (!pr) {
      return NextResponse.json({ error: 'PR 不存在' }, { status: 404 })
    }

    return NextResponse.json({ pullRequest: pr })
  } catch (error) {
    console.error('Get PR error:', error)
    return NextResponse.json({ error: '获取 PR 失败' }, { status: 500 })
  }
}

// PATCH /api/pull-requests/:id - Update PR
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

    const pr = await prisma.pullRequest.findUnique({
      where: { id: parseInt(id) },
      include: {
        batch: true
      }
    })

    if (!pr) {
      return NextResponse.json({ error: 'PR 不存在' }, { status: 404 })
    }

    if (!pr.batch) {
      return NextResponse.json({ error: 'PR 未关联批次' }, { status: 400 })
    }

    if (pr.userId !== session.id) {
      return NextResponse.json({ error: '无权限' }, { status: 403 })
    }

    if (pr.batch.status !== 'Draft') {
      return NextResponse.json(
        { error: '只能编辑草稿状态批次中的 PR' },
        { status: 400 }
      )
    }

    const body = await request.json()
    const { word, oldWord, code, action, type, weight, remark } = body

    if (action === 'Change' && !oldWord) {
      return NextResponse.json(
        { error: '修改操作需要指定旧词' },
        { status: 400 }
      )
    }

    // Check for conflicts with updated data
    const conflict = await conflictDetector.checkConflict({
      action: action as PullRequestType,
      word,
      oldWord,
      code,
      phraseId: pr.phraseId || undefined,
      weight
    })

    // For Delete action, phrase must exist
    if (action === 'Delete' && conflict.hasConflict) {
      return NextResponse.json(
        {
          error: conflict.impact || '词条不存在，无法删除',
          suggestions: conflict.suggestions
        },
        { status: 400 }
      )
    }

    // Update PR
    const updated = await prisma.pullRequest.update({
      where: { id: parseInt(id) },
      data: {
        word,
        oldWord: action === 'Change' ? oldWord : null,
        code,
        action: action as PullRequestType,
        type: type || undefined,
        weight: weight || undefined,
        remark: remark || undefined,
        hasConflict: conflict.hasConflict,
        conflictReason: conflict.hasConflict ? conflict.impact : null
      } as any,
      include: {
        phrase: true,
        batch: true,
        user: {
          select: {
            id: true,
            name: true,
            nickname: true
          }
        }
      }
    })

    // Update conflict records
    await prisma.codeConflict.deleteMany({
      where: { pullRequestId: pr.id }
    })

    if (conflict.hasConflict && conflict.currentPhrase) {
      await prisma.codeConflict.create({
        data: {
          code: conflict.code,
          currentWord: conflict.currentPhrase.word,
          proposedWord: word,
          pullRequestId: pr.id
        }
      })
    }

    return NextResponse.json({ pullRequest: updated })
  } catch (error) {
    console.error('Update PR error:', error)
    return NextResponse.json({ error: '更新 PR 失败' }, { status: 500 })
  }
}

// DELETE /api/pull-requests/:id - Delete PR
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

    const pr = await prisma.pullRequest.findUnique({
      where: { id: parseInt(id) },
      include: {
        batch: true,
        dependedBy: true
      }
    })

    if (!pr) {
      return NextResponse.json({ error: 'PR 不存在' }, { status: 404 })
    }

    if (!pr.batch) {
      return NextResponse.json({ error: 'PR 未关联批次' }, { status: 400 })
    }

    if (pr.userId !== session.id) {
      return NextResponse.json({ error: '无权限' }, { status: 403 })
    }

    if (pr.batch.status !== 'Draft') {
      return NextResponse.json(
        { error: '只能删除草稿状态批次中的 PR' },
        { status: 400 }
      )
    }

    if (pr.dependedBy.length > 0) {
      return NextResponse.json(
        { error: '该 PR 被其他 PR 依赖，无法删除' },
        { status: 400 }
      )
    }

    await prisma.pullRequest.delete({
      where: { id: parseInt(id) }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete PR error:', error)
    return NextResponse.json({ error: '删除 PR 失败' }, { status: 500 })
  }
}
