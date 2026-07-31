import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { conflictDetector } from '@/lib/services/conflictDetector'
import { Prisma, PullRequestStatus, PullRequestType } from '@prisma/client'
import { isValidPhraseType } from '@/lib/constants/phraseTypes'
import { resolvePhraseTargetBinding } from '@/lib/services/phraseTargetBinding'
import { BatchContentLockedError, claimBatchContentMutation } from '@/lib/services/batchContentGuard'

// POST /api/pull-requests - Create a single PR
export async function POST(request: NextRequest) {
  const allowedActions = ['Create', 'Change', 'Delete'] as const
  const maxWordLength = 100
  const maxCodeLength = 20

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
      batchId,
      expectedContentVersion,
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

    if (typeof word !== 'string' || typeof code !== 'string' || word.trim().length > maxWordLength || code.trim().length > maxCodeLength) {
      return NextResponse.json({ error: '词条或编码过长' }, { status: 400 })
    }

    if (oldWord !== undefined && (typeof oldWord !== 'string' || oldWord.trim().length > maxWordLength)) {
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
    const targetBinding = await resolvePhraseTargetBinding(prisma.phrase, {
      action,
      word: word.trim(),
      oldWord: action === 'Change' ? oldWord.trim() : undefined,
      code: code.trim(),
      type,
      phraseId: finalPhraseId,
    })

    // If no batchId provided, create a new batch
    let finalBatchId = batchId
    let claimedContentVersion: number
    if (finalBatchId) {
      const batch = await prisma.batch.findUnique({
        where: { id: finalBatchId },
        select: { id: true, creatorId: true, status: true, contentVersion: true }
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
      if (!Number.isInteger(expectedContentVersion) || expectedContentVersion < 0) {
        return NextResponse.json({ error: '批次版本缺失或无效，请刷新后重试' }, { status: 409 })
      }
      if (batch.contentVersion !== expectedContentVersion) {
        return NextResponse.json({ error: '批次内容已被修改，请刷新后重试' }, { status: 409 })
      }
      claimedContentVersion = expectedContentVersion
    } else {
      const batch = await prisma.batch.create({
        data: {
          description: `修改词条: ${word.trim()}`,
          creatorId: session.id,
          status: 'Draft'
        }
      })
      finalBatchId = batch.id
      claimedContentVersion = batch.contentVersion
    }

    // Calculate weight for Create action with duplicate codes
    let finalWeight = weight
    if (action === 'Create') {
      // For Create action, don't store weight - it will be calculated dynamically
      // when the batch is executed based on batch context
      finalWeight = undefined
    }

    const pr = await prisma.$transaction(async (tx) => {
      await claimBatchContentMutation(tx, finalBatchId, {
        creatorId: session.id,
        expectedContentVersion: claimedContentVersion,
      })
      const created = await tx.pullRequest.create({
        data: {
          word: word.trim(),
          oldWord: action === 'Change' ? oldWord.trim() : undefined,
          code: code.trim(),
          action: action as PullRequestType,
          phraseId: finalPhraseId || undefined,
          targetPhraseId: targetBinding.targetPhraseId,
          targetFingerprint: targetBinding.targetFingerprint,
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

      if (conflict.hasConflict && conflict.currentPhrase) {
        await tx.codeConflict.create({
          data: {
            code: conflict.code,
            currentWord: conflict.currentPhrase.word,
            proposedWord: word,
            pullRequestId: created.id
          }
        })
      }
      return created
    })

    return NextResponse.json({
      pullRequest: pr,
      contentVersion: claimedContentVersion + 1,
      conflict: conflict.hasConflict ? conflict : undefined
    })
  } catch (error) {
    if (error instanceof BatchContentLockedError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('Create PR error:', error)
    return NextResponse.json({ error: '创建 PR 失败' }, { status: 500 })
  }
}

// GET /api/pull-requests - List PRs
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const rawPage = parseInt(searchParams.get('page') || '1', 10)
    const rawPageSize = parseInt(searchParams.get('pageSize') || '10', 10)
    const page = Number.isFinite(rawPage) ? Math.min(100, Math.max(1, rawPage)) : 1
    const pageSize = Number.isFinite(rawPageSize) ? Math.min(100, Math.max(1, rawPageSize)) : 10
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
