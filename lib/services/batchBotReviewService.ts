import { prisma } from '@/lib/prisma'
import type { BatchAiReviewItem, BatchAiReviewResult } from '@/lib/types/batchAiReview'
import { getMiaomiaoSemanticEvidence, stripMiaomiaoReviewRemark } from './miaomiaoReviewRemark'
import {
  BatchContentLockedError,
  claimBatchContentMutation,
  EDITABLE_BATCH_STATUSES,
} from './batchContentGuard'

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
  warning?: string
  aiReview?: BatchAiReviewResult
}

const MIAOMIAO_REVIEW_TIMEOUT_MS = 290_000

export interface MiaomiaoBatchReviewResponse {
  aiReview: BatchAiReviewResult
  warning?: string
}

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

export async function requestMiaomiaoBatchReviewDetailed(input: {
  batch: ReviewableBatch
  localReview: BatchAiReviewResult
  focusPrId?: number
  timeoutMs?: number
}): Promise<MiaomiaoBatchReviewResponse> {
  const controller = new AbortController()
  const timeoutMs = Math.min(
    Math.max(input.timeoutMs ?? MIAOMIAO_REVIEW_TIMEOUT_MS, 10_000),
    MIAOMIAO_REVIEW_TIMEOUT_MS,
  )
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
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
  if (!response.ok || data.success === false || !data.aiReview) {
    throw new Error(data.detail || data.message || `喵喵复审服务返回 ${response.status}`)
  }

  return {
    aiReview: data.aiReview,
    warning: data.warning,
  }
}

export async function requestMiaomiaoBatchReview(input: {
  batch: ReviewableBatch
  localReview: BatchAiReviewResult
  focusPrId?: number
  timeoutMs?: number
}): Promise<BatchAiReviewResult> {
  const result = await requestMiaomiaoBatchReviewDetailed(input)
  return result.aiReview
}

function statusText(item: BatchAiReviewItem): string {
  if (item.status === 'pass') return '通过'
  if (item.status === 'manual_review') return '需人工确认'
  return '需复核'
}

export function formatMiaomiaoReviewRemark(item: BatchAiReviewItem, generatedAt: string): string {
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
  const persistedSources = Array.from(new Set([
    ...(record?.sources ?? []),
    ...(record?.commonSenseSources ?? []),
  ].map(source => source.trim()).filter(Boolean)))
  // Always persist the field: an empty value is an explicit retraction of
  // legacy sources, while a missing field remains backward-compatible.
  lines.push(`来源：${persistedSources.join('、')}`)
  for (const evidence of record ? getMiaomiaoSemanticEvidence(record).slice(0, 3) : []) {
    lines.push(`证据：${evidence}`)
  }
  lines.push(`时间：${generatedAt}`)
  lines.push('--- miao-review:end ---')
  return lines.join('\n')
}

export class StaleBatchReviewError extends Error {
  readonly status = 409

  constructor() {
    super('批次状态或内容在复审期间已发生变化，本次复审结果已作废，请重新发起复审')
    this.name = 'StaleBatchReviewError'
  }
}

export async function writeMiaomiaoBatchReview(input: {
  batch: ReviewableBatch
  aiReview: BatchAiReviewResult
  expectedContentVersion: number
}): Promise<void> {
  const reviewByPrId = new Map(input.aiReview.items.map(item => [item.prId, item]))
  const remarkUpdates: Array<{ id: number; remark: string }> = []

  for (const pr of input.batch.pullRequests) {
    const item = reviewByPrId.get(pr.id)
    if (!item) continue

    const baseRemark = stripMiaomiaoReviewRemark(pr.remark)
    const nextRemark = [
      baseRemark,
      formatMiaomiaoReviewRemark(item, input.aiReview.generatedAt),
    ].filter(Boolean).join('\n\n')

    remarkUpdates.push({ id: pr.id, remark: nextRemark })
  }

  await prisma.$transaction(async (tx) => {
    try {
      await claimBatchContentMutation(tx, input.batch.id, {
        expectedContentVersion: input.expectedContentVersion,
        allowedStatuses: [...EDITABLE_BATCH_STATUSES, 'Submitted'],
      })
    } catch (error) {
      if (error instanceof BatchContentLockedError) throw new StaleBatchReviewError()
      throw error
    }

    for (const update of remarkUpdates) {
      const updated = await tx.pullRequest.updateMany({
        where: { id: update.id, batchId: input.batch.id },
        data: { remark: update.remark },
      })
      if (updated.count !== 1) throw new StaleBatchReviewError()
    }

    const fresh = await tx.batch.findUniqueOrThrow({
      where: { id: input.batch.id },
      select: { status: true },
    })
    if (fresh.status === 'Submitted') {
      await tx.batch.update({
        where: { id: input.batch.id },
        data: { reviewNote: input.aiReview.suggestedReviewNote },
      })
    }
  })
}
