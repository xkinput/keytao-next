import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkAdminPermission } from '@/lib/adminAuth'
import type { Prisma } from '@prisma/client'

type PullRequestWithPhrase = Prisma.PullRequestGetPayload<{
  include: { phrase: true }
}>

// POST /api/admin/batches/:id/approve - Approve a batch
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authCheck = await checkAdminPermission()
    if (!authCheck.authorized) {
      return authCheck.response
    }

    const { id } = await params
    const body = await request.json()
    const { reviewNote } = body

    const batch = await prisma.batch.findUnique({
      where: { id },
      include: {
        pullRequests: {
          include: {
            phrase: true
          },
          orderBy: {
            createAt: 'asc'
          }
        }
      }
    })

    if (!batch) {
      return NextResponse.json({ error: '批次不存在' }, { status: 404 })
    }

    if (batch.status !== 'Submitted') {
      return NextResponse.json(
        { error: '只能审核待审核状态的批次' },
        { status: 400 }
      )
    }

    // Calculate dynamic weights before execution
    const { checkBatchConflictsWithWeight } = await import('@/lib/services/batchConflictService')

    const prItems = batch.pullRequests.map((pr: PullRequestWithPhrase) => ({
      id: String(pr.id),
      action: pr.action as 'Create' | 'Change' | 'Delete',
      word: pr.word || '',
      oldWord: pr.oldWord || undefined,
      code: pr.code || '',
      type: pr.type || 'Phrase',
      weight: pr.weight || undefined,
    }))

    const conflictResults = await checkBatchConflictsWithWeight(prItems)

    // Create a map of PR ID to calculated weight
    const weightMap = new Map<number, number>()
    conflictResults.forEach(result => {
      const prId = parseInt(result.id)
      if (!isNaN(prId) && result.calculatedWeight !== undefined) {
        weightMap.set(prId, result.calculatedWeight)
      }
    })

    // Apply all PRs in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Process each PR
      for (const pr of batch.pullRequests as PullRequestWithPhrase[]) {
        switch (pr.action) {
          case 'Create':
            // Create new phrase
            if (pr.word && pr.code) {
              // Use dynamically calculated weight if available, fallback to pr.weight
              const finalWeight = weightMap.get(pr.id) ?? pr.weight ?? 0

              await tx.phrase.create({
                data: {
                  word: pr.word,
                  code: pr.code,
                  type: pr.type || 'Phrase',
                  weight: finalWeight,
                  remark: pr.remark,
                  userId: pr.userId,
                  status: 'Finish'
                }
              })
            }
            break

          case 'Change':
            // Update existing phrase - change word for given code+oldWord
            if ((pr as any).oldWord && pr.code && pr.word) {
              // Find phrase by oldWord + code
              const oldPhrase = await tx.phrase.findFirst({
                where: {
                  word: (pr as any).oldWord,
                  code: pr.code
                }
              })

              if (oldPhrase) {
                // Use dynamically calculated weight if available
                const finalWeight = weightMap.get(pr.id)

                // Update the word (and optionally type/weight/remark)
                await tx.phrase.update({
                  where: { id: oldPhrase.id },
                  data: {
                    word: pr.word,
                    type: pr.type || undefined,
                    weight: finalWeight !== undefined ? finalWeight : (pr.weight !== null ? pr.weight : undefined),
                    remark: pr.remark || undefined
                  }
                })
              }
            } else if (pr.phraseId) {
              // Fallback to old behavior using phraseId
              const finalWeight = weightMap.get(pr.id)

              await tx.phrase.update({
                where: { id: pr.phraseId },
                data: {
                  word: pr.word || undefined,
                  type: pr.type || undefined,
                  weight: finalWeight !== undefined ? finalWeight : (pr.weight !== null ? pr.weight : undefined),
                  remark: pr.remark || undefined
                }
              })
            }
            break

          case 'Delete':
            // Delete phrase
            if (pr.phraseId) {
              await tx.phrase.delete({
                where: { id: pr.phraseId }
              })
            } else if (pr.word && pr.code) {
              // If phraseId not set, find by word and code
              await tx.phrase.deleteMany({
                where: {
                  word: pr.word,
                  code: pr.code
                }
              })
            }
            break
        }

        // Update PR status
        await tx.pullRequest.update({
          where: { id: pr.id },
          data: {
            status: 'Approved'
          }
        })
      }

      // Update batch status
      const updated = await tx.batch.update({
        where: { id },
        data: {
          status: 'Approved',
          reviewNote: reviewNote || null
        }
      })

      return updated
    })

    return NextResponse.json({ batch: result })
  } catch (error) {
    console.error('Approve batch error:', error)
    const errorMessage = error instanceof Error ? error.message : '批准批次失败'
    return NextResponse.json({ error: '批准批次失败', details: errorMessage }, { status: 500 })
  }
}
