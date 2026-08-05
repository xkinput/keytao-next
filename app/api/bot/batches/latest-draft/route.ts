import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireVerifiedBotUser } from '@/lib/botUserAuth'
import { findCurrentBotDraftBatch } from '@/lib/services/botDraftBatch'

/**
 * Bot API: Read the caller's current draft batch
 * GET /api/bot/batches/latest-draft
 * Requires a valid Bot token and a bound platform user
 *
 * This endpoint is strictly read-only. It used to be a get-or-create, which
 * meant a pure preview could mint an empty draft batch and steal the "current
 * draft" pointer from a batch that was about to be recalled (incident: the
 * empty ec511ac6 shadowing 785e0368). Batch creation now belongs to the write
 * endpoints only (`/api/bot/pull-requests/batch` and
 * `/api/bot/pull-requests/batch-draft`), which create on the first confirmed
 * write.
 *
 * When the user has no draft batch the response keeps the same shape with
 * `batchId: null` and `exists: false` (a 404 would be indistinguishable from
 * "platform account not bound" for existing clients).
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const platform = searchParams.get('platform') as 'qq' | 'telegram' | null
    const platformId = searchParams.get('platformId')

    console.log('[Bot API] Get latest draft batch request:', {
      platform,
      platformId
    })

    const auth = await requireVerifiedBotUser(platform, platformId, { request, rawBody: '' })
    if (!auth.authorized) {
      return NextResponse.json(
        {
          success: false,
          message: auth.message
        },
        { status: auth.status }
      )
    }
    const user = auth.user

    const batch = await findCurrentBotDraftBatch(prisma, user.id)

    if (!batch) {
      // `batchId: null` + `contentVersion: 0` is the CAS baseline for "this
      // user has no draft yet": a write may send it (with no batchId) to
      // create the first draft, and the server re-checks the absence under the
      // write lock. See NEW_BOT_DRAFT_BATCH_IDENTITY.
      return NextResponse.json({
        success: true,
        batchId: null,
        exists: false,
        pullRequestCount: 0,
        contentVersion: 0,
        isNew: false,
        message: '当前没有草稿批次'
      })
    }

    return NextResponse.json({
      success: true,
      batchId: batch.id,
      exists: true,
      pullRequestCount: batch.pullRequestCount,
      contentVersion: batch.contentVersion,
      isNew: false,
      message: batch.pullRequestCount > 0
        ? `找到草稿批次，已包含 ${batch.pullRequestCount} 个修改`
        : '找到空的草稿批次'
    })
  } catch (error) {
    console.error('[Bot API] Get latest draft batch error:', error)

    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2025') {
      return NextResponse.json(
        {
          success: false,
          message: '未找到绑定账号'
        },
        { status: 404 }
      )
    }

    const errorMessage = error instanceof Error ? error.message : '未知错误'
    return NextResponse.json(
      {
        success: false,
        message: `获取批次失败：${errorMessage}`
      },
      { status: 500 }
    )
  }
}
