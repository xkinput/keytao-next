import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { conflictDetector } from '@/lib/services/conflictDetector'
import { rebuildBatchDependencies } from '@/lib/services/batchDependencyService'
import { Prisma, PullRequestType } from '@prisma/client'
import { checkIsAdmin } from '@/lib/adminAuth'
import { getPhraseWeightValidationError, isValidPhraseType, type PhraseType } from '@/lib/constants/phraseTypes'
import { resolvePhraseTargetBinding } from '@/lib/services/phraseTargetBinding'
import { BatchContentLockedError, claimBatchContentMutation } from '@/lib/services/batchContentGuard'
import { containsMiaomiaoReviewBlockDelimiter } from '@/lib/validation/phraseInput'

const ALLOWED_ACTIONS = ['Create', 'Change', 'Delete'] as const
const MAX_WORD_LENGTH = 100
const MAX_CODE_LENGTH = 20
const MAX_REMARK_LENGTH = 500

function parsePrId(id: string) {
  const prId = parseInt(id, 10)
  return Number.isInteger(prId) && prId > 0 ? prId : null
}

// GET /api/pull-requests/:id - Get PR with dependencies
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const prId = parsePrId(id)
    if (!prId) {
      return NextResponse.json({ error: '无效的 PR ID' }, { status: 400 })
    }

    const pr = await prisma.pullRequest.findUnique({
      where: { id: prId },
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
    const prId = parsePrId(id)
    if (!prId) {
      return NextResponse.json({ error: '无效的 PR ID' }, { status: 400 })
    }

    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const pr = await prisma.pullRequest.findUnique({
      where: { id: prId },
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

    const isAdmin = await checkIsAdmin(session.id)
    if (pr.userId !== session.id && !isAdmin) {
      return NextResponse.json({ error: '无权限' }, { status: 403 })
    }

    const allowedStatuses = isAdmin ? ['Draft', 'Rejected', 'Submitted'] : ['Draft', 'Rejected']
    if (!allowedStatuses.includes(pr.batch.status)) {
      return NextResponse.json(
        { error: '只能编辑草稿或已拒绝状态批次中的 PR' },
        { status: 400 }
      )
    }

    const body = await request.json()
    const { word, oldWord, code, action, type, weight, remark, expectedContentVersion } = body
    const normalizedWord = typeof word === 'string' ? word.trim() : ''
    const normalizedCode = typeof code === 'string' ? code.trim() : ''
    const normalizedOldWord = typeof oldWord === 'string' ? oldWord.trim() : undefined

    if (!ALLOWED_ACTIONS.includes(action)) {
      return NextResponse.json({ error: '无效的操作类型' }, { status: 400 })
    }

    if (!normalizedWord || !normalizedCode || normalizedWord.length > MAX_WORD_LENGTH || normalizedCode.length > MAX_CODE_LENGTH) {
      return NextResponse.json({ error: '词条或编码格式错误' }, { status: 400 })
    }

    if (action === 'Change' && !normalizedOldWord) {
      return NextResponse.json(
        { error: '修改操作需要指定旧词' },
        { status: 400 }
      )
    }

    if (normalizedOldWord !== undefined && normalizedOldWord.length > MAX_WORD_LENGTH) {
      return NextResponse.json({ error: '旧词过长' }, { status: 400 })
    }

    if (type && !isValidPhraseType(type)) {
      return NextResponse.json({ error: '无效的词库类型' }, { status: 400 })
    }
    if (weight !== undefined && weight !== null) {
      const phraseType = (type || pr.type || 'Phrase') as PhraseType
      const weightError = getPhraseWeightValidationError(weight, phraseType)
      if (weightError) {
        return NextResponse.json({ error: weightError }, { status: 400 })
      }
    }

    if (
      remark !== undefined
      && (
        typeof remark !== 'string'
        || remark.length > MAX_REMARK_LENGTH
        || containsMiaomiaoReviewBlockDelimiter(remark)
      )
    ) {
      return NextResponse.json({ error: '备注格式错误' }, { status: 400 })
    }

    if (!Number.isInteger(expectedContentVersion) || expectedContentVersion < 0) {
      return NextResponse.json({ error: '批次版本缺失或无效，请刷新后重试' }, { status: 409 })
    }
    if (pr.batch.contentVersion !== expectedContentVersion) {
      return NextResponse.json({ error: '批次内容已被修改，请刷新后重试' }, { status: 409 })
    }

    // Check for conflicts with updated data
    const conflict = await conflictDetector.checkConflict({
      action: action as PullRequestType,
      word: normalizedWord,
      oldWord: normalizedOldWord,
      code: normalizedCode,
      type,
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

    const targetBinding = await resolvePhraseTargetBinding(prisma.phrase, {
      action,
      word: normalizedWord,
      oldWord: normalizedOldWord,
      code: normalizedCode,
      type,
      phraseId: pr.phraseId,
    })

    // Update PR
    const updateData: Prisma.PullRequestUpdateInput = {
      word: normalizedWord,
      oldWord: action === 'Change' ? normalizedOldWord : null,
      code: normalizedCode,
      action: action as PullRequestType,
      type: type || undefined,
      weight: weight ?? undefined,
      remark: remark !== undefined ? (remark || null) : undefined,
      hasConflict: conflict.hasConflict,
      conflictReason: conflict.hasConflict ? conflict.impact : null,
      targetPhraseId: targetBinding.targetPhraseId,
      targetFingerprint: targetBinding.targetFingerprint,
    }

    const batchIdOfPr = pr.batch.id
    const updated = await prisma.$transaction(async (tx) => {
      await claimBatchContentMutation(tx, batchIdOfPr, {
        expectedContentVersion,
        allowedStatuses,
      })
      const result = await tx.pullRequest.update({
        where: { id: prId, batchId: batchIdOfPr },
        data: updateData,
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

      await tx.codeConflict.deleteMany({
        where: { pullRequestId: pr.id }
      })

      if (conflict.hasConflict && conflict.currentPhrase) {
        await tx.codeConflict.create({
          data: {
            code: conflict.code,
            currentWord: conflict.currentPhrase.word,
            proposedWord: normalizedWord,
            pullRequestId: pr.id
          }
        })
      }
      return result
    })

    // Rebuild all batch dependencies since changing one PR can affect the whole batch
    await rebuildBatchDependencies(
      pr.batch.id,
      expectedContentVersion + 1,
      allowedStatuses,
    )

    return NextResponse.json({ pullRequest: updated, contentVersion: expectedContentVersion + 1 })
  } catch (error) {
    if (error instanceof BatchContentLockedError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
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
    const prId = parsePrId(id)
    if (!prId) {
      return NextResponse.json({ error: '无效的 PR ID' }, { status: 400 })
    }

    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const pr = await prisma.pullRequest.findUnique({
      where: { id: prId },
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

    const isAdmin = await checkIsAdmin(session.id)
    if (pr.userId !== session.id && !isAdmin) {
      return NextResponse.json({ error: '无权限' }, { status: 403 })
    }

    const allowedStatuses = isAdmin ? ['Draft', 'Rejected', 'Submitted'] : ['Draft', 'Rejected']
    if (!allowedStatuses.includes(pr.batch.status)) {
      return NextResponse.json(
        { error: '只能删除草稿或已拒绝状态批次中的 PR' },
        { status: 400 }
      )
    }

    if (pr.dependedBy.length > 0) {
      return NextResponse.json(
        { error: '该 PR 被其他 PR 依赖，无法删除' },
        { status: 400 }
      )
    }

    const body = await request.json().catch(() => ({})) as { expectedContentVersion?: unknown }
    const expectedContentVersion = body.expectedContentVersion
    if (!Number.isInteger(expectedContentVersion) || (expectedContentVersion as number) < 0) {
      return NextResponse.json({ error: '批次版本缺失或无效，请刷新后重试' }, { status: 409 })
    }
    if (pr.batch.contentVersion !== expectedContentVersion) {
      return NextResponse.json({ error: '批次内容已被修改，请刷新后重试' }, { status: 409 })
    }

    const batchIdOfPr = pr.batch.id
    await prisma.$transaction(async (tx) => {
      await claimBatchContentMutation(tx, batchIdOfPr, {
        expectedContentVersion: expectedContentVersion as number,
        allowedStatuses,
      })
      const removed = await tx.pullRequest.deleteMany({
        where: { id: prId, batchId: batchIdOfPr }
      })
      if (removed.count !== 1) {
        throw new BatchContentLockedError('条目已被其他操作移除，请刷新后重试')
      }
    })

    return NextResponse.json({
      success: true,
      contentVersion: (expectedContentVersion as number) + 1,
    })
  } catch (error) {
    if (error instanceof BatchContentLockedError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('Delete PR error:', error)
    return NextResponse.json({ error: '删除 PR 失败' }, { status: 500 })
  }
}
