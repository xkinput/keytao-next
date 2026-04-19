import { NextRequest, NextResponse } from 'next/server'
import { verifyBotToken } from '@/lib/botAuth'
import { prisma } from '@/lib/prisma'
import { isValidPlatform, resolveUserByPlatform } from '@/lib/botUserResolver'
import { checkBatchConflictsWithWeight, recheckBatchConflicts } from '@/lib/services/batchConflictService'
import { buildDependencies } from '@/lib/services/batchDependencyService'
import { PullRequestType } from '@prisma/client'
import { PhraseType } from '@/lib/constants/phraseTypes'
import type { BotCreatePRRequest, BotCreatePRResponse, BotConflictInfo, BotWarningInfo, BotDeleteNoteInfo } from '@/lib/types/bot'

/**
 * Bot API: Create PRs in batch
 * POST /api/bot/pull-requests/batch
 * Requires Bot token authentication
 */
export async function POST(request: NextRequest) {
  try {
    // Verify bot token
    if (!await verifyBotToken()) {
      return NextResponse.json<BotCreatePRResponse>(
        {
          success: false,
          message: '未授权'
        },
        { status: 401 }
      )
    }

    const body: BotCreatePRRequest = await request.json()
    const { platform, platformId, items, confirmed, batchId } = body

    console.log('[Bot API] Received request:', {
      platform,
      platformId,
      confirmed,
      batchId,
      itemsCount: items?.length,
      items: items?.map(i => ({ action: i.action, word: i.word, code: i.code }))
    })

    // Validate parameters
    if (!platform || !platformId || !items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json<BotCreatePRResponse>(
        {
          success: false,
          message: '缺少必需参数'
        },
        { status: 400 }
      )
    }

    if (!isValidPlatform(platform)) {
      return NextResponse.json<BotCreatePRResponse>(
        {
          success: false,
          message: '不支持的平台'
        },
        { status: 400 }
      )
    }

    // Find user by platform ID
    const user = await resolveUserByPlatform(platform, platformId)

    if (!user) {
      return NextResponse.json<BotCreatePRResponse>(
        {
          success: false,
          message: '未找到账号'
        },
        { status: 404 }
      )
    }

    // Validate all items
    const validationItems = items.map((item, idx) => ({
      id: idx.toString(),
      action: item.action as 'Create' | 'Change' | 'Delete',
      word: item.word || '',
      oldWord: item.oldWord || undefined,
      code: item.code || '',
      type: (item.type || 'Phrase') as PhraseType,
      weight: item.weight || undefined
    }))

    // Check for basic validation errors
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (!item.word || !item.code || !item.action) {
        return NextResponse.json<BotCreatePRResponse>(
          {
            success: false,
            message: `项目 #${i + 1}: 缺少必要字段（word/code/action）`
          },
          { status: 400 }
        )
      }
      if (item.action === 'Change' && !item.oldWord) {
        return NextResponse.json<BotCreatePRResponse>(
          {
            success: false,
            message: `项目 #${i + 1}: 修改操作需要指定旧词（oldWord）`
          },
          { status: 400 }
        )
      }
    }

    // Run conflict detection
    const results = await checkBatchConflictsWithWeight(validationItems)

    // Categorize results: conflicts (真冲突) vs warnings (重码警告) vs notes (删除信息)
    const conflicts: BotConflictInfo[] = []
    const warnings: BotWarningInfo[] = []
    const notes: BotDeleteNoteInfo[] = []

    for (let i = 0; i < results.length; i++) {
      const result = results[i]
      const item = items[i]

      // Check if resolved within batch
      const isResolved = result.conflict.suggestions?.some(sug => sug.action === 'Resolved')

      if (result.conflict.hasConflict) {
        // True conflict - must reject
        conflicts.push({
          index: i,
          item,
          error: result.conflict.impact || '操作冲突',
          reason: result.conflict.suggestions?.[0]?.reason || '未知原因'
        })
      } else if (item.action === 'Delete' && result.conflict.currentPhrase) {
        // Delete: non-blocking, but record what will be deleted for informational purposes
        notes.push({
          index: i,
          word: result.conflict.currentPhrase.word,
          code: result.conflict.currentPhrase.code,
          weight: result.conflict.currentPhrase.weight,
          type: result.conflict.currentPhrase.type ?? undefined,
        })
      } else if (
        result.conflict.currentPhrase &&
        !isResolved &&
        !(item.action === 'Change' && result.conflict.currentPhrase.word === item.oldWord)
      ) {
        // Warning - needs confirmation (Create/Change only)
        const isDuplicateCode = result.conflict.currentPhrase.code === item.code &&
          result.conflict.currentPhrase.word !== item.word

        warnings.push({
          index: i,
          item,
          warningType: isDuplicateCode ? 'duplicate_code' : 'multiple_code',
          message: result.conflict.impact || '存在警告',
          existing: {
            word: result.conflict.currentPhrase.word,
            code: result.conflict.currentPhrase.code,
            weight: result.conflict.currentPhrase.weight
          }
        })
      }
    }

    // If there are true conflicts, reject immediately
    if (conflicts.length > 0) {
      return NextResponse.json<BotCreatePRResponse>(
        {
          success: false,
          conflicts,
          message: `存在 ${conflicts.length} 个无法解决的冲突`
        },
        { status: 400 }
      )
    }

    // If there are warnings and not confirmed, return warnings
    if (warnings.length > 0 && !confirmed) {
      const responseData = {
        success: false,
        warnings,
        requiresConfirmation: true,
        message: `存在 ${warnings.length} 个需要确认的警告（重码或多编码）`
      }
      console.log('[Bot API] Returning warnings response:', JSON.stringify(responseData, null, 2))
      return NextResponse.json<BotCreatePRResponse>(responseData)
    }

    // Check for duplicates in existing draft batch
    if (batchId) {
      const existingPRs = await prisma.pullRequest.findMany({
        where: {
          batchId: batchId
        },
        select: {
          action: true,
          word: true,
          code: true
        }
      })

      // Check each item for duplicates
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        const isDuplicate = existingPRs.some(
          pr => pr.action === item.action &&
            pr.word === item.word &&
            pr.code === item.code
        )

        if (isDuplicate) {
          const actionName = item.action === 'Create' ? '添加' :
            item.action === 'Change' ? '修改' : '删除'
          return NextResponse.json<BotCreatePRResponse>(
            {
              success: false,
              message: `草稿批次中已存在相同的修改：${actionName}词条【${item.word}】(编码: ${item.code})\n\n请勿重复添加，可以直接提交审核哦～`
            },
            { status: 400 }
          )
        }
      }
    }

    // Create batch and PRs (same logic as frontend)
    const result = await prisma.$transaction(async (tx) => {
      // Use existing batch or create new one
      let batch
      if (batchId) {
        // Find existing batch
        batch = await tx.batch.findUnique({
          where: { id: batchId },
          select: {
            id: true,
            creatorId: true,
            status: true,
            description: true
          }
        })

        if (!batch) {
          throw new Error('批次不存在')
        }

        if (batch.creatorId !== user.id) {
          throw new Error('无权限操作此批次')
        }

        if (batch.status !== 'Draft') {
          throw new Error('批次已提交，无法继续添加')
        }
      } else {
        // Create new batch
        batch = await tx.batch.create({
          data: {
            description: items.length === 1
              ? `键道助手添加: ${items[0].word}`
              : `键道助手批量添加 ${items.length} 个词条`,
            creatorId: user.id,
            status: 'Draft'
          }
        })
      }

      // Create all PRs
      const prs = await Promise.all(
        items.map((item, idx) =>
          tx.pullRequest.create({
            data: {
              word: item.word,
              oldWord: item.oldWord || undefined,
              code: item.code,
              action: item.action as PullRequestType,
              weight: item.weight || undefined,
              remark: item.remark || null,
              type: (item.type || 'Phrase') as PhraseType,
              userId: user.id,
              batchId: batch.id,
              hasConflict: false,
              conflictReason: results[idx]?.conflict?.suggestions?.some(s => s.action === 'Resolved')
                ? null
                : results[idx]?.conflict?.impact || null,
            }
          })
        )
      )

      // Build dependencies if conflicts are resolved within batch
      await buildDependencies(prs, results, tx)

      return { batch, prs }
    })

    // Re-check full batch conflict state so all existing items reflect the updated context
    await recheckBatchConflicts(result.batch.id)

    const responseData: BotCreatePRResponse = {
      success: true,
      batchId: result.batch.id,
      pullRequestCount: result.prs.length,
      message: `成功创建批次，包含 ${result.prs.length} 个修改提议`,
      ...(notes.length > 0 && { notes }),
    }
    console.log('[Bot API] Returning success response:', JSON.stringify(responseData, null, 2))
    return NextResponse.json<BotCreatePRResponse>(responseData)
  } catch (error: any) {
    console.error('[Bot API] Error:', error)

    // Handle specific error types
    if (error.code === 'P2022') {
      // Prisma column not found
      return NextResponse.json<BotCreatePRResponse>(
        {
          success: false,
          message: '数据库配置错误，请联系管理员检查数据库迁移状态'
        },
        { status: 500 }
      )
    }

    if (error.code === 'P2025') {
      // Record not found
      return NextResponse.json<BotCreatePRResponse>(
        {
          success: false,
          message: '未找到绑定账号。\n\n请先使用 /bind 命令绑定你的平台账号到键道加词平台～'
        },
        { status: 404 }
      )
    }

    // Generic error
    return NextResponse.json<BotCreatePRResponse>(
      {
        success: false,
        message: `创建失败：${error.message || '未知错误'}`
      },
      { status: 500 }
    )
  }
}
