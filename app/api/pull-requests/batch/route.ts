import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { conflictDetector } from '@/lib/services/conflictDetector'
import { PullRequestType } from '@prisma/client'

// POST /api/pull-requests/batch - Create multiple PRs in a batch
export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const body = await request.json()
    const { changes, batchDescription, issueId } = body

    if (!changes || !Array.isArray(changes) || changes.length === 0) {
      return NextResponse.json(
        { error: '缺少修改列表' },
        { status: 400 }
      )
    }

    // Validate all changes
    const validation = await conflictDetector.validateBatch(changes)

    if (!validation.valid) {
      return NextResponse.json(
        {
          error: '存在未解决的冲突',
          conflicts: validation.unresolvedConflicts
        },
        { status: 400 }
      )
    }

    // Create batch and PRs in transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create batch
      const batch = await tx.batch.create({
        data: {
          description: batchDescription || '批量修改',
          creatorId: session.id,
          issueId: issueId || undefined,
          status: 'Draft'
        }
      })

      // Create all PRs
      const prs = await Promise.all(
        changes.map((change: any) =>
          tx.pullRequest.create({
            data: {
              word: change.word,
              code: change.code,
              action: change.action as PullRequestType,
              phraseId: change.phraseId || undefined,
              weight: change.weight || undefined,
              remark: change.remark || undefined,
              type: change.type || undefined,
              userId: session.id,
              batchId: batch.id,
              hasConflict: false
            }
          })
        )
      )

      // Build dependencies if conflicts are resolved within batch
      for (const conflict of validation.conflicts) {
        if (conflict.currentPhrase) {
          // Find the PR that moves the conflicting phrase
          const movingPR = prs.find(
            (pr) => pr.phraseId === conflict.currentPhrase!.id
          )

          // Find the PR that wants to occupy the code
          const occupyingPR = prs.find(
            (pr) => pr.code === conflict.code && pr.phraseId !== conflict.currentPhrase!.id
          )

          if (movingPR && occupyingPR) {
            // occupyingPR depends on movingPR (must execute movingPR first)
            await tx.pullRequestDependency.create({
              data: {
                dependentId: occupyingPR.id,
                dependsOnId: movingPR.id,
                reason: `必须先将 "${conflict.currentPhrase.word}" 从编码 "${conflict.code}" 移走`
              }
            })
          }
        }
      }

      return { batch, prs }
    })

    return NextResponse.json({
      batch: result.batch,
      pullRequests: result.prs,
      conflictsResolved: validation.conflicts.length
    })
  } catch (error) {
    console.error('Create batch PRs error:', error)
    return NextResponse.json(
      { error: '批量创建 PR 失败' },
      { status: 500 }
    )
  }
}
