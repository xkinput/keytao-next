import { prisma } from '@/lib/prisma'
import type { BatchAiReviewItem, BatchAiReviewResult } from '@/lib/types/batchAiReview'

type ReviewableBatch = {
  id: string
  status: string
  description?: string | null
  reviewNote?: string | null
  pullRequests: Array<{
    id: number
    remark: string | null
    [key: string]: unknown
  }>
}

type BotBatchReviewResponse = {
  success?: boolean
  message?: string
  detail?: string
  aiReview?: BatchAiReviewResult
}

const MIAOMIAO_REVIEW_BLOCK_PATTERN = /\n?--- miao-review:start ---[\s\S]*?--- miao-review:end ---/g
const MIAOMIAO_REVIEW_TIMEOUT_MS = 290_000

function botReviewUrl(): string {
  const baseUrl = (process.env.BOT_API_URL || 'http://localhost:8080').replace(/\/+$/, '')
  return `${baseUrl}/api/keytao/batches/review`
}

function botReviewHeaders(): HeadersInit {
  const apiKey = process.env.BOT_API_KEY || ''
  return {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  }
}

export async function requestMiaomiaoBatchReview(input: {
  batch: ReviewableBatch
  localReview: BatchAiReviewResult
  focusPrId?: number
}): Promise<BatchAiReviewResult> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), MIAOMIAO_REVIEW_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(botReviewUrl(), {
      method: 'POST',
      headers: botReviewHeaders(),
      body: JSON.stringify({
        batch: input.batch,
        local_review: input.localReview,
        focus_pr_id: input.focusPrId,
      }),
      signal: controller.signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('喵喵复审服务超时，请稍后再试')
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }

  const data = await response.json().catch(() => ({})) as BotBatchReviewResponse
  if (!response.ok || !data.aiReview) {
    throw new Error(data.detail || data.message || `喵喵复审服务返回 ${response.status}`)
  }

  return data.aiReview
}

function statusText(item: BatchAiReviewItem): string {
  if (item.status === 'pass') return '通过'
  if (item.status === 'manual_review') return '需人工确认'
  return '需复核'
}

function stripExistingMiaomiaoReview(remark: string | null): string {
  return (remark || '').replace(MIAOMIAO_REVIEW_BLOCK_PATTERN, '').trim()
}

function formatMiaomiaoReviewRemark(item: BatchAiReviewItem, generatedAt: string): string {
  const record = item.reviewRecord
  const lines = [
    '--- miao-review:start ---',
    `本喵复审：${statusText(item)}`,
    `结论：${item.title}`,
  ]

  const reasons = item.reasons.slice(0, 3).filter(Boolean).join('；')
  const suggestions = item.suggestions.slice(0, 3).filter(Boolean).join('；')
  if (reasons) {
    lines.push(`理由：${reasons}`)
  }
  if (suggestions) {
    lines.push(`建议：${suggestions}`)
  }
  if (record?.pronunciation) {
    lines.push(`读音：${record.pronunciation}`)
  }
  if (record?.sources.length) {
    lines.push(`来源：${record.sources.join('、')}`)
  }
  for (const evidence of record?.evidence.slice(0, 3) ?? []) {
    lines.push(`证据：${evidence}`)
  }
  lines.push(`时间：${generatedAt}`)
  lines.push('--- miao-review:end ---')
  return lines.join('\n')
}

export async function writeMiaomiaoBatchReview(input: {
  batch: ReviewableBatch
  aiReview: BatchAiReviewResult
}): Promise<void> {
  const reviewByPrId = new Map(input.aiReview.items.map(item => [item.prId, item]))
  const updates: PromiseLike<unknown>[] = []

  for (const pr of input.batch.pullRequests) {
    const item = reviewByPrId.get(pr.id)
    if (!item) continue

    const baseRemark = stripExistingMiaomiaoReview(pr.remark)
    const nextRemark = [
      baseRemark,
      formatMiaomiaoReviewRemark(item, input.aiReview.generatedAt),
    ].filter(Boolean).join('\n\n')

    updates.push(prisma.pullRequest.update({
      where: { id: pr.id },
      data: { remark: nextRemark },
    }))
  }

  if (input.batch.status === 'Submitted') {
    updates.push(prisma.batch.update({
      where: { id: input.batch.id },
      data: { reviewNote: input.aiReview.suggestedReviewNote },
    }))
  }

  await Promise.all(updates)
}
