import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { conflictDetector } from '@/lib/services/conflictDetector'
import { Prisma, PullRequestStatus, PullRequestType } from '@prisma/client'
import { isValidPhraseType } from '@/lib/constants/phraseTypes'

// POST /api/pull-requests - Create a single PR
export async function POST(request: NextRequest) {
  const allowedActions = ['Create', 'Change', 'Delete'] as const
  const maxTextLength = 20

  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const body = await request.json()
    const {
      word,
      oldWord,
      code,
      action,
      phraseId,
      weight,
      remark,
      type,
      batchId
    } = body

    if (!word || !code || !action) {
      return NextResponse.json(
        { error: '缺少必要参数' },
        { status: 400 }
      )
    }

    if (action === 'Change' && !oldWord) {
      return NextResponse.json(
        { error: '修改操作需要指定旧词' },
        { status: 400 }
      )
    }

    if (!allowedActions.includes(action)) {
      return NextResponse.json({ error: '无效的操作类型' }, { status: 400 })
    }

    if (typeof word !== 'string' || typeof code !== 'string' || word.trim().length > maxTextLength || code.trim().length > maxTextLength) {
      return NextResponse.json({ error: '词条或编码过长' }, { status: 400 })
    }

    if (oldWord !== undefined && (typeof oldWord !== 'string' || oldWord.trim().length > maxTextLength)) {
      return NextResponse.json({ error: '旧词过长' }, { status: 400 })
    }

    if (type && !isValidPhraseType(type)) {
      return NextResponse.json({ error: '无效的词库类型' }, { status: 400 })
    }

    if (remark !== undefined && typeof remark === 'string' && remark.length > 500) {
      return NextResponse.json({ error: '备注过长' }, { status: 400 })
    }

    // Check for conflicts
    const conflict = await conflictDetector.checkConflict({
      action: action as PullRequestType,
      word,
      oldWord,
      code,
      phraseId,
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

    // For Change and Delete actions, try to find phraseId if not provided
    let finalPhraseId = phraseId
    if (!finalPhraseId && (action === 'Change' || action === 'Delete')) {
      const searchWord = action === 'Change' ? oldWord : word
      const existingPhrase = await prisma.phrase.findFirst({
        where: {
          word: searchWord,
          code,
          type: type || undefined
        }
      })
      if (existingPhrase) {
        finalPhraseId = existingPhrase.id
      }
    }

    // If no batchId provided, create a new batch
    let finalBatchId = batchId
    if (finalBatchId) {
      const batch = await prisma.batch.findUnique({
        where: { id: finalBatchId },
        select: { id: true, creatorId: true, status: true }
      })

      if (!batch) {
        return NextResponse.json({ error: '批次不存在' }, { status: 404 })
      }

      if (batch.creatorId !== session.id) {
        return NextResponse.json({ error: '无权限操作此批次' }, { status: 403 })
      }

      if (batch.status !== 'Draft' && batch.status !== 'Rejected') {
        return NextResponse.json({ error: '只能编辑草稿或已拒绝状态的批次' }, { status: 400 })
      }
    } else {
      const batch = await prisma.batch.create({
        data: {
          description: `修改词条: ${word.trim()}`,
          creatorId: session.id,
          status: 'Draft'
        }
      })
      finalBatchId = batch.id
    }

    // Calculate weight for Create action with duplicate codes
    let finalWeight = weight
    if (action === 'Create') {
      // For Create action, don't store weight - it will be calculated dynamically
      // when the batch is executed based on batch context
      finalWeight = undefined
    }

    // Create PR
    const pr = await prisma.pullRequest.create({
      data: {
        word: word.trim(),
        oldWord: action === 'Change' ? oldWord.trim() : undefined,
        code: code.trim(),
        action: action as PullRequestType,
        phraseId: finalPhraseId || undefined,
        weight: finalWeight || undefined,
        remark: remark || null,
        type: type || undefined,
        userId: session.id,
        batchId: finalBatchId,
        hasConflict: conflict.hasConflict,
        conflictReason: conflict.hasConflict ? conflict.impact : undefined
      },
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

    // If has conflict, create conflict record
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

    return NextResponse.json({
      pullRequest: pr,
      conflict: conflict.hasConflict ? conflict : undefined
    })
  } catch (error) {
    console.error('Create PR error:', error)
    return NextResponse.json({ error: '创建 PR 失败' }, { status: 500 })
  }
}

// GET /api/pull-requests - List PRs
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const page = Math.min(100, Math.max(1, parseInt(searchParams.get('page') || '1')))
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '10')))
    const status = searchParams.get('status')
    const batchId = searchParams.get('batchId')

    const where: Prisma.PullRequestWhereInput = {}
    if (status && Object.values(PullRequestStatus).includes(status as PullRequestStatus)) {
      where.status = status as PullRequestStatus
    }
    if (batchId) {
      where.batchId = batchId
    }

    const [prs, total] = await Promise.all([
      prisma.pullRequest.findMany({
        where,
        include: {
          phrase: true,
          batch: {
            select: {
              id: true,
              description: true,
              status: true
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
          _count: {
            select: {
              dependencies: true,
              dependedBy: true
            }
          }
        },
        orderBy: { createAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      prisma.pullRequest.count({ where })
    ])

    return NextResponse.json({
      pullRequests: prs,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize)
      }
    })
  } catch (error) {
    console.error('Get PRs error:', error)
    return NextResponse.json({ error: '获取 PR 列表失败' }, { status: 500 })
  }
}
