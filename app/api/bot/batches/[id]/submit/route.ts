import { NextRequest, NextResponse } from 'next/server'
import { verifyBotToken } from '@/lib/botAuth'
import { prisma } from '@/lib/prisma'
import { checkBatchConflictsWithWeight } from '@/lib/services/batchConflictService'
import { PhraseType } from '@/lib/constants/phraseTypes'

/**
 * Bot API: Submit batch for review
 * POST /api/bot/batches/:id/submit
 * Requires Bot token authentication
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Verify bot token
    if (!await verifyBotToken()) {
      return NextResponse.json(
        { success: false, message: '未授权' },
        { status: 401 }
      )
    }

    const { id } = await params
    const body = await request.json()
    const { platform, platformId } = body

    // Validate parameters
    if (!platform || !platformId) {
      return NextResponse.json(
        { success: false, message: '缺少必需参数' },
        { status: 400 }
      )
    }

    // Find user by platform
    const platformField = platform === 'qq' ? 'qqId' : platform === 'telegram' ? 'telegramId' : null
    if (!platformField) {
      return NextResponse.json(
        { success: false, message: '不支持的平台' },
        { status: 400 }
      )
    }

    let user
    try {
      user = await prisma.user.findFirst({
        where: {
          [platformField]: platformId
        }
      })
    } catch (prismaError: any) {
      console.error('[Bot API] Prisma error:', prismaError)

      if (prismaError.code === 'P2022') {
        return NextResponse.json(
          { success: false, message: '系统配置错误，请联系管理员更新数据库' },
          { status: 500 }
        )
      }

      throw prismaError
    }

    if (!user) {
      return NextResponse.json(
        { success: false, message: '未找到绑定账号。\n\n请先使用 /bind 命令绑定你的平台账号到键道加词平台～' },
        { status: 404 }
      )
    }

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
          message: '批次中存在未解决的冲突',
          conflicts: unresolvedConflicts
        },
        { status: 400 }
      )
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
  } catch (error: any) {
    console.error('[Bot API] Submit error:', error)

    // Handle specific error types
    if (error.code === 'P2022') {
      return NextResponse.json(
        { success: false, message: '数据库配置错误，请联系管理员检查数据库迁移状态' },
        { status: 500 }
      )
    }

    if (error.code === 'P2025') {
      return NextResponse.json(
        { success: false, message: '批次或用户不存在' },
        { status: 404 }
      )
    }

    return NextResponse.json(
      { success: false, message: `提交失败：${error.message || '未知错误'}` },
      { status: 500 }
    )
  }
}
