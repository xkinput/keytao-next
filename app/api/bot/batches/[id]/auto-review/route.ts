import { NextRequest, NextResponse } from 'next/server'
import { verifyBotToken } from '@/lib/botAuth'
import { getBatchReviewDetailSnapshot, requestBatchMiaomiaoItemReview } from '@/lib/services/adminBatchReviewDetailService'
import {
  computeReviewDigest,
  isMiaomiaoReviewRateLimit,
  MiaomiaoReviewRateLimitError,
  writeMiaomiaoItemReviewsByDigest,
} from '@/lib/services/batchBotReviewService'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    if (!await verifyBotToken()) {
      return NextResponse.json({ success: false, message: '未授权' }, { status: 401 })
    }
    const body = await request.json().catch(() => null)
    const prIds: unknown = body?.prIds
    if (!Array.isArray(prIds) || prIds.length < 1 || prIds.length > 12 ||
      !prIds.every(id => Number.isInteger(id) && id >= 1 && id <= 2147483647) ||
      new Set(prIds).size !== prIds.length) {
      return NextResponse.json({ success: false, message: '每组复审须提供 1 至 12 个不重复的有效词条 ID' }, { status: 400 })
    }

    const { id } = await params
    const snapshot = await getBatchReviewDetailSnapshot(id)
    if (!snapshot) {
      return NextResponse.json({ success: false, message: '批次不存在' }, { status: 404 })
    }
    const { batch, rawPullRequests } = snapshot
    if (batch.status === 'Approved') {
      return NextResponse.json({ success: false, message: '已通过的批次不能重新复审' }, { status: 409 })
    }

    const rawById = new Map(rawPullRequests.filter(pr => !pr.appliedAt).map(pr => [pr.id, pr]))
    const targetDigests = new Map<number, string>()
    const initiallySkipped: number[] = []
    for (const prId of prIds) {
      const row = rawById.get(prId)
      if (row) targetDigests.set(prId, computeReviewDigest(row))
      else initiallySkipped.push(prId)
    }
    if (!targetDigests.size) {
      return NextResponse.json({ success: true, reviewed: [], skipped: initiallySkipped })
    }

    const aiReview = await requestBatchMiaomiaoItemReview(
      batch, batch.pullRequests.filter(pr => !pr.appliedAt), 170_000, Array.from(targetDigests.keys()),
    )
    if (isMiaomiaoReviewRateLimit(aiReview.warning)) {
      return NextResponse.json({ rateLimited: true }, { status: 429 })
    }
    const { reviewed, skipped } = await writeMiaomiaoItemReviewsByDigest({ batchId: id, targetDigests, aiReview })
    return NextResponse.json({ success: true, reviewed, skipped: [...initiallySkipped, ...skipped] })
  } catch (error) {
    if (error instanceof MiaomiaoReviewRateLimitError) {
      return NextResponse.json({ rateLimited: true }, { status: 429 })
    }
    console.error('Automatic Miaomiao review error:', error)
    return NextResponse.json({ success: false, message: '喵喵复查失败' }, { status: 500 })
  }
}
