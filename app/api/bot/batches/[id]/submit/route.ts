import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireVerifiedBotUser } from '@/lib/botUserAuth'
import { checkBatchConflictsWithWeight } from '@/lib/services/batchConflictService'
import { buildBatchSubmitWarnings } from '@/lib/services/batchSubmitWarnings'
import { buildSkippedCandidateSlotWarnings } from '@/lib/services/batchSkippedCodeWarnings'
import { buildPriorityOrderWarnings } from '@/lib/services/batchPriorityOrderWarnings'
import { PhraseType } from '@/lib/constants/phraseTypes'

function getErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '未知错误'
}

/**
 * Bot API: Submit batch for review
 * POST /api/bot/batches/:id/submit
 * Requires a valid Bot token and a bound platform user
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { platform, platformId, confirmed = false } = body

    const auth = await requireVerifiedBotUser(platform, platformId)
    if (!auth.authorized) {
      return NextResponse.json(
        { success: false, message: auth.message },
        { status: auth.status }
      )
    }
    const user = auth.user

    // Get batch
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
      return NextResponse.json(
        { success: false, message: '批次不存在' },
        { status: 404 }
      )
    }

    // Check ownership
    if (batch.creatorId !== user.id) {
      return NextResponse.json(
        { success: false, message: '无权限操作此批次' },
        { status: 403 }
      )
    }

    // Check status
    if (batch.status !== 'Draft' && batch.status !== 'Rejected') {
      return NextResponse.json(
        { success: false, message: '只能提交草稿或已拒绝状态的批次' },
        { status: 400 }
      )
    }

    // Check if batch has PRs
    if (batch.pullRequests.length === 0) {
      return NextResponse.json(
        { success: false, message: '批次中没有修改提议' },
        { status: 400 }
      )
    }

    // Validate batch for conflicts
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
          success: false,
          message: '批次中存在未解决的冲突，无法提交',
          conflicts: unresolvedConflicts
        },
        { status: 400 }
      )
    }

    // Check for warnings (重码/多编码) — block until confirmed
    if (!confirmed) {
      const warnings = [
        ...buildBatchSubmitWarnings(items, results),
        ...await buildSkippedCandidateSlotWarnings(items),
        ...await buildPriorityOrderWarnings(items),
      ]

      if (warnings.length > 0) {
        return NextResponse.json(
          {
            success: false,
            warnings,
            requiresConfirmation: true,
            message: `批次中存在 ${warnings.length} 个重码/多编码/跳过编码空位/同码链优先级警告，确认后可继续提交`
          },
          { status: 400 }
        )
      }
    }

    // Update batch status to Submitted
    const updated = await prisma.batch.update({
      where: { id },
      data: {
        status: 'Submitted',
        reviewNote: null
      }
    })

    return NextResponse.json({
      success: true,
      message: '批次已提交审核',
      batch: {
        id: updated.id,
        status: updated.status
      }
    })
  } catch (error: unknown) {
    console.error('[Bot API] Submit error:', error)

    // Handle specific error types
    const errorCode = getErrorCode(error)
    if (errorCode === 'P2022') {
      return NextResponse.json(
        { success: false, message: '数据库配置错误，请联系管理员检查数据库迁移状态' },
        { status: 500 }
      )
    }

    if (errorCode === 'P2025') {
      return NextResponse.json(
        { success: false, message: '批次或用户不存在' },
        { status: 404 }
      )
    }

    return NextResponse.json(
      { success: false, message: `提交失败：${getErrorMessage(error)}` },
      { status: 500 }
    )
  }
}
