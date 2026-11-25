import { NextRequest, NextResponse } from 'next/server'
import { checkAdminPermission } from '@/lib/adminAuth'
import { AI_REVIEW_CHUNK_SIZE } from '@/lib/services/aiReviewChunks'
import { getAdminBatchReviewDetail, requestBatchMiaomiaoItemReview } from '@/lib/services/adminBatchReviewDetailService'
import {
  StaleBatchReviewError,
  writeMiaomiaoBatchReview,
} from '@/lib/services/batchBotReviewService'

export const runtime = 'nodejs'
export const maxDuration = 300

function isPullRequestId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 2147483647
}

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
    const payload = await request.text()
    let body: unknown
    try {
      body = payload.trim() ? JSON.parse(payload) : {}
    } catch {
      body = null
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: '复审请求格式无效' }, { status: 400 })
    }
    const { prId, prIds } = body as { prId?: unknown; prIds?: unknown }
    let targetIds: number[] | undefined
    if (prIds !== undefined) {
      if (prId !== undefined || !Array.isArray(prIds) || prIds.length < 1 || prIds.length > AI_REVIEW_CHUNK_SIZE ||
        !prIds.every(isPullRequestId) || new Set(prIds).size !== prIds.length) {
        return NextResponse.json({ error: '每组复审须提供 1 至 12 个不重复的有效词条 ID' }, { status: 400 })
      }
      targetIds = prIds
    } else if (isPullRequestId(prId)) {
      targetIds = [prId]
    } else if (prId !== undefined) {
      return NextResponse.json({ error: '词条 ID 无效' }, { status: 400 })
    }
    const batch = await getAdminBatchReviewDetail(id)

    if (!batch) {
      return NextResponse.json({ error: '批次不存在' }, { status: 404 })
    }
    if (batch.status === 'Approved') {
      return NextResponse.json({ error: '已通过的批次不能重新复审' }, { status: 409 })
    }
    const pullRequests = batch.pullRequests.filter(pr => !pr.appliedAt)
    const pullRequestById = new Map(pullRequests.map(pr => [pr.id, pr]))
    const targets = targetIds?.map(prId => pullRequestById.get(prId)).filter(pr => pr !== undefined) ?? pullRequests
    if (!targets.length || (targetIds && targets.length !== targetIds.length)) {
      return NextResponse.json({ error: '未找到可复审的词条' }, { status: 404 })
    }
    // Capture the content version the reviewer is about to look at. The remote
    // review can take minutes; binding the result to this version means a
    // content edit or status transition invalidates the verdict instead of
    // applying a result to a batch that has moved on.
    const reviewedContentVersion = batch.contentVersion

    const aiReview = await requestBatchMiaomiaoItemReview(batch, pullRequests, 280_000, targetIds)
    const reviewedIds = new Set(aiReview.items.map(item => item.prId))
    if (targets.some(pr => !reviewedIds.has(pr.id))) {
      return NextResponse.json({ error: '喵喵未返回完整的逐词复审结果' }, { status: 502 })
    }

    await writeMiaomiaoBatchReview({
      batch: { ...batch, pullRequests: targets },
      aiReview,
      expectedContentVersion: reviewedContentVersion,
    })

    return NextResponse.json({ reviewedAt: aiReview.generatedAt, warning: aiReview.warning })
  } catch (error) {
    if (error instanceof StaleBatchReviewError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('Manual admin AI review error:', error)
    return NextResponse.json({ error: '喵喵复查失败' }, { status: 500 })
  }
}
