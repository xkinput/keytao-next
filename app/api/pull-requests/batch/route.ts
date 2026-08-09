import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkBatchConflictsWithWeight } from '@/lib/services/batchConflictService'
import { buildDependencies } from '@/lib/services/batchDependencyService'
import { PullRequestType } from '@prisma/client'
import { getPhraseWeightValidationError, isValidPhraseType, PhraseType } from '@/lib/constants/phraseTypes'
import { resolvePhraseTargetBinding } from '@/lib/services/phraseTargetBinding'
import { BatchContentLockedError, claimBatchContentMutation } from '@/lib/services/batchContentGuard'
import {
  containsMiaomiaoReviewBlockDelimiter,
  MAX_REMARK_LENGTH,
} from '@/lib/validation/phraseInput'

type BatchPullRequestItem = {
  action: PullRequestType
  word: string
  oldWord?: string
  code: string
  type?: PhraseType
  weight?: number
  phraseId?: number
  remark?: string
}

// POST /api/pull-requests/batch - Create multiple PRs in a batch
export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const body = await request.json()
    const { changes, items, batchDescription, batchId, issueId, expectedContentVersion } = body

    if (
      batchId
      && (!Number.isInteger(expectedContentVersion) || expectedContentVersion < 0)
    ) {
      return NextResponse.json(
        { error: '批次版本缺失或无效，请刷新后重试' },
        { status: 409 }
      )
    }

    // Support both 'changes' and 'items' for backward compatibility
    const prItems = items || changes

    if (!prItems || !Array.isArray(prItems) || prItems.length === 0) {
      return NextResponse.json(
        { error: '缺少修改列表' },
        { status: 400 }
      )
    }

    const invalidRemark = (prItems as BatchPullRequestItem[]).find(change => (
      change.remark !== undefined
      && (
        typeof change.remark !== 'string'
        || change.remark.length > MAX_REMARK_LENGTH
        || containsMiaomiaoReviewBlockDelimiter(change.remark)
      )
    ))
    if (invalidRemark) {
      return NextResponse.json({ error: '备注格式错误' }, { status: 400 })
    }

    for (let i = 0; i < prItems.length; i++) {
      const item = prItems[i] as BatchPullRequestItem
      const phraseType = item.type || 'Phrase'
      if (!isValidPhraseType(phraseType)) {
        return NextResponse.json({ error: `项目 #${i + 1}: 无效的词库类型` }, { status: 400 })
      }
      if (item.weight !== undefined && item.weight !== null) {
        const weightError = getPhraseWeightValidationError(item.weight, phraseType)
        if (weightError) {
          return NextResponse.json({ error: `项目 #${i + 1}: ${weightError}` }, { status: 400 })
        }
      }
    }

    // Validate all changes using unified conflict detection
    const validationItems = (prItems as BatchPullRequestItem[]).map((change, idx) => ({
      id: idx.toString(),
      action: change.action as 'Create' | 'Change' | 'Delete',
      word: change.word || '',
      oldWord: change.oldWord || undefined,
      code: change.code || '',
      type: (change.type || 'Phrase') as PhraseType,
      weight: change.weight ?? undefined
    }))

    const results = await checkBatchConflictsWithWeight(validationItems)

    // Check for unresolved conflicts
    const unresolvedConflicts = results
      .filter(result => {
        const isResolved = result.conflict.suggestions?.some(sug => sug.action === 'Resolved')
        return result.conflict.hasConflict && !isResolved
      })
      .map(result => result.conflict)

    if (unresolvedConflicts.length > 0) {
      return NextResponse.json(
        {
          error: '存在未解决的冲突',
          conflicts: unresolvedConflicts
        },
        { status: 400 }
      )
    }

    // Create batch and PRs in transaction
    const result = await prisma.$transaction(async (tx) => {
      // Use existing batch or create new one
      let batch
      if (batchId) {
        batch = await tx.batch.findUnique({ where: { id: batchId } })
        if (!batch) {
          throw new Error('批次不存在')
        }
        if (batch.creatorId !== session.id) {
          throw new Error('无权限')
        }
        if (batch.status !== 'Draft' && batch.status !== 'Rejected') {
          throw new Error('只能编辑草稿或已拒绝状态的批次')
        }
        await claimBatchContentMutation(tx, batch.id, {
          creatorId: session.id,
          expectedContentVersion,
        })
      } else {
        batch = await tx.batch.create({
          data: {
            description: batchDescription || (prItems.length === 1
              ? `修改词条: ${prItems[0].word}`
              : `批量修改 ${prItems.length} 个词条`),
            creatorId: session.id,
            issueId: issueId || undefined,
            status: 'Draft'
          }
        })
        await claimBatchContentMutation(tx, batch.id, {
          creatorId: session.id,
          expectedContentVersion: batch.contentVersion,
        })
      }

      // Create all PRs
      const prs = await Promise.all(
        (prItems as BatchPullRequestItem[]).map(async (change) => {
          const binding = await resolvePhraseTargetBinding(tx.phrase, change)
          return tx.pullRequest.create({
            data: {
              word: change.word,
              oldWord: change.oldWord || undefined,
              code: change.code,
              action: change.action as PullRequestType,
              phraseId: change.phraseId || undefined,
              targetPhraseId: binding.targetPhraseId,
              targetFingerprint: binding.targetFingerprint,
              weight: change.weight ?? undefined,
              remark: change.remark || null,
              type: change.type || undefined,
              userId: session.id,
              batchId: batch.id,
              hasConflict: false
            }
          })
        })
      )

      // Build dependencies if conflicts are resolved within batch
      await buildDependencies(prs, results, tx)

      return { batch, prs, contentVersion: batch.contentVersion + 1 }
    })

    return NextResponse.json({
      batch: result.batch,
      contentVersion: result.contentVersion,
      pullRequests: result.prs,
      conflictsResolved: results.filter(r =>
        r.conflict.suggestions?.some(sug => sug.action === 'Resolved')
      ).length
    })
  } catch (error) {
    if (error instanceof BatchContentLockedError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('Create batch PRs error:', error)
    return NextResponse.json(
      { error: '批量创建 PR 失败' },
      { status: 500 }
    )
  }
}
