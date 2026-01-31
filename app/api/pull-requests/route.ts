import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { conflictDetector } from '@/lib/services/conflictDetector'
import { PullRequestType } from '@prisma/client'
import { getDefaultWeight, isValidPhraseType, type PhraseType } from '@/lib/constants/phraseTypes'

// POST /api/pull-requests - Create a single PR
export async function POST(request: NextRequest) {
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
          code
        }
      })
      if (existingPhrase) {
        finalPhraseId = existingPhrase.id
      }
    }

    // If no batchId provided, create a new batch
    let finalBatchId = batchId
    if (!finalBatchId) {
      const batch = await prisma.batch.create({
        data: {
          description: `修改词条: ${word}`,
          creatorId: session.id,
          status: 'Draft'
        }
      })
      finalBatchId = batch.id
    }

    // Calculate weight for Create action with duplicate codes
    let finalWeight = weight
    if (action === 'Create' && type && weight === undefined) {
      // Count existing phrases with this code
      const existingCount = await prisma.phrase.count({
        where: { code }
      })

      // If there are existing phrases with this code, adjust weight
      if (existingCount > 0) {
        const baseWeight = getDefaultWeight(type as PhraseType)
        // Each additional phrase on same code gets base + count
        finalWeight = baseWeight + existingCount
      } else {
        // First phrase with this code, use default weight
        finalWeight = getDefaultWeight(type as PhraseType)
      }
    }

    // Create PR
    const pr = await prisma.pullRequest.create({
      data: {
        word,
        oldWord: action === 'Change' ? oldWord : undefined,
        code,
        action: action as PullRequestType,
        phraseId: finalPhraseId || undefined,
        weight: finalWeight || undefined,
        remark: remark || undefined,
        type: type || undefined,
        userId: session.id,
        batchId: finalBatchId,
        hasConflict: conflict.hasConflict,
        conflictReason: conflict.hasConflict ? conflict.impact : undefined
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
    const page = parseInt(searchParams.get('page') || '1')
    const pageSize = parseInt(searchParams.get('pageSize') || '10')
    const status = searchParams.get('status')
    const batchId = searchParams.get('batchId')

    const where: Record<string, any> = {}
    if (status) {
      where.status = status
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
