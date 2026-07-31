import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkBatchConflictsWithWeight } from '@/lib/services/batchConflictService'
import { buildBatchSubmitWarnings } from '@/lib/services/batchSubmitWarnings'
import { buildSkippedCandidateSlotWarnings } from '@/lib/services/batchSkippedCodeWarnings'
import { buildPriorityOrderWarnings } from '@/lib/services/batchPriorityOrderWarnings'
import { PhraseType } from '@/lib/constants/phraseTypes'
import {
  buildBotWarningDigest,
  lockPhraseTableForWarningSnapshot,
} from '@/lib/services/botWarningSnapshot'

// POST /api/batches/:id/submit - Submit batch for review
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }
    const body = await request.json().catch(() => ({})) as {
      confirmed?: unknown
      expectedContentVersion?: unknown
      expectedWarningDigest?: unknown
    }
    const confirmed = body.confirmed === true
    if (body.confirmed !== undefined && typeof body.confirmed !== 'boolean') {
      return NextResponse.json({ error: 'confirmed 类型错误' }, { status: 400 })
    }
    if (
      body.expectedContentVersion !== undefined
      && (!Number.isInteger(body.expectedContentVersion) || (body.expectedContentVersion as number) < 0)
    ) {
      return NextResponse.json({ error: 'expectedContentVersion 类型错误' }, { status: 400 })
    }
    if (confirmed && body.expectedContentVersion === undefined) {
      return NextResponse.json({ error: '确认提交必须包含 expectedContentVersion' }, { status: 400 })
    }
    if (
      confirmed
      && (typeof body.expectedWarningDigest !== 'string' || !/^[a-f0-9]{64}$/.test(body.expectedWarningDigest))
    ) {
      return NextResponse.json({ error: '确认提交必须包含 expectedWarningDigest' }, { status: 400 })
    }

    const batch = await prisma.batch.findUnique({
      where: { id },
      include: {
        pullRequests: {
          orderBy: {
            createAt: 'asc'
          }
        }
      }
    })

    if (!batch) {
      return NextResponse.json({ error: '批次不存在' }, { status: 404 })
    }

    if (batch.creatorId !== session.id) {
      return NextResponse.json({ error: '无权限' }, { status: 403 })
    }

    if (batch.status !== 'Draft' && batch.status !== 'Rejected') {
      return NextResponse.json(
        { error: '只能提交草稿或已拒绝状态的批次' },
        { status: 400 }
      )
    }

    const expectedContentVersion = body.expectedContentVersion === undefined
      ? batch.contentVersion
      : body.expectedContentVersion as number
    if (batch.contentVersion !== expectedContentVersion) {
      return NextResponse.json({ error: '批次内容已被修改，请刷新后重试' }, { status: 409 })
    }

    if (batch.pullRequests.length === 0) {
      return NextResponse.json(
        { error: '批次中没有修改提议' },
        { status: 400 }
      )
    }

    // Validate batch for conflicts using the same logic as check-conflicts-batch
    const items = batch.pullRequests.map((pr) => ({
      id: pr.id.toString(),
      action: pr.action as 'Create' | 'Change' | 'Delete',
      word: pr.word || '',
      oldWord: pr.oldWord || undefined,
      code: pr.code || '',
      type: (pr.type || 'Phrase') as PhraseType,
      weight: pr.weight || undefined
    }))

    const results = await checkBatchConflictsWithWeight(items)

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
          error: '批次中存在未解决的冲突',
          conflicts: unresolvedConflicts
        },
        { status: 400 }
      )
    }

    const warnings = [
      ...buildBatchSubmitWarnings(items, results),
      ...await buildSkippedCandidateSlotWarnings(items),
      ...await buildPriorityOrderWarnings(items),
    ]
    const warningState = { results, warnings }
    const warningDigest = await buildBotWarningDigest(prisma, items, warningState)

    if (!confirmed) {
      if (warnings.length > 0) {
        return NextResponse.json(
          {
            error: `批次中存在 ${warnings.length} 个重码/多编码/跳过编码空位/同码链优先级警告，确认后可继续提交`,
            warnings,
            requiresConfirmation: true,
            batchId: batch.id,
            contentVersion: batch.contentVersion,
            warningDigest,
          },
          { status: 400 }
        )
      }
    }

    if (confirmed && warningDigest !== body.expectedWarningDigest) {
      return NextResponse.json({ error: '警告快照已变化，请重新确认' }, { status: 409 })
    }

    // Update batch status
    const transition = () => prisma.batch.updateMany({
      where: {
        id,
        creatorId: session.id,
        status: { in: ['Draft', 'Rejected'] },
        contentVersion: expectedContentVersion,
      },
      data: {
        status: 'Submitted',
        reviewNote: null // Clear previous rejection note
      }
    })
    const transitioned = confirmed
      ? await prisma.$transaction(async (tx) => {
        await lockPhraseTableForWarningSnapshot(tx)
        const lockedDigest = await buildBotWarningDigest(tx, items, warningState)
        if (lockedDigest !== body.expectedWarningDigest) return { count: 0 }
        return tx.batch.updateMany({
          where: {
            id,
            creatorId: session.id,
            status: { in: ['Draft', 'Rejected'] },
            contentVersion: expectedContentVersion,
          },
          data: { status: 'Submitted', reviewNote: null },
        })
      })
      : await transition()

    if (transitioned.count !== 1) {
      return NextResponse.json({ error: '批次内容或状态已被其他操作修改，请刷新后重试' }, { status: 409 })
    }

    return NextResponse.json({
      batch: { id, status: 'Submitted', contentVersion: expectedContentVersion },
    })
  } catch (error) {
    console.error('Submit batch error:', error)
    return NextResponse.json({ error: '提交批次失败' }, { status: 500 })
  }
}
