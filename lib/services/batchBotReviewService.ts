import { prisma } from '@/lib/prisma'
import type { BatchAiReviewCodeChain, BatchAiReviewItem, BatchAiReviewResult } from '@/lib/types/batchAiReview'
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

type BotBatchReviewResponse<T> = {
  success?: boolean
  message?: string
  detail?: string
  warning?: string
  aiReview?: T
}

const MIAOMIAO_REVIEW_TIMEOUT_MS = 290_000
type ItemReviewResult = Pick<BatchAiReviewResult, 'items' | 'generatedAt'>

interface BotReviewInput {
  batch: ReviewableBatch
  localReview: {
    items: BatchAiReviewItem[]
    codeChains: Omit<BatchAiReviewCodeChain, 'recommendations'>[]
  }
  focusPrId?: number
  timeoutMs?: number
}

export interface MiaomiaoBatchReviewResponse {
  aiReview: BatchAiReviewResult
  warning?: string
}

type FocusReviewItem = {
  id: number
  action?: string
  word?: string | null
  oldWord?: string | null
  code?: string | null
  type?: string | null
  phrase?: { word: string; code: string } | null
  dependencies?: readonly ({ dependsOnId: number } | { dependsOn: { id: number } })[]
  dependedBy?: readonly { dependent: { id: number } }[]
}

export function selectAiReviewFocusContext<T extends FocusReviewItem>(
  unappliedItems: readonly T[],
  targetId: number,
): T[] {
  const items = unappliedItems.map(pr => {
    const code = (pr.code ?? pr.phrase?.code ?? '').trim().toLowerCase()
    return {
      pr,
      word: (pr.word ?? pr.phrase?.word ?? '').trim(),
      oldWord: pr.action === 'Change' ? (pr.oldWord ?? '').trim() : '',
      type: pr.type || 'Phrase',
      code,
      hasPrefixCode: Array.from(code).length >= 3,
      linkedIds: new Set([
        ...(pr.dependencies ?? []).map(link => 'dependsOnId' in link ? link.dependsOnId : link.dependsOn.id),
        ...(pr.dependedBy ?? []).map(link => link.dependent.id),
      ]),
    }
  })
  const target = items.find(item => item.pr.id === targetId)
  if (!target) return []

  // ponytail: Cap focus review at 24 items, truncating larger connected components.
  const limit = 24
  const queue = [target]
  const seen = new Set([targetId])
  for (let index = 0; index < queue.length && queue.length < limit; index++) {
    const current = queue[index]
    const explicit = []
    const related = []
    for (const candidate of items) {
      if (seen.has(candidate.pr.id)) continue
      if (current.linkedIds.has(candidate.pr.id) || candidate.linkedIds.has(current.pr.id)
        || (current.oldWord && current.oldWord === candidate.word)
        || (candidate.oldWord && candidate.oldWord === current.word)
        || (current.oldWord && current.oldWord === candidate.oldWord && current.word === candidate.word)) {
        explicit.push(candidate)
      } else if ((current.word && current.word === candidate.word)
        || (current.type === candidate.type && current.hasPrefixCode && candidate.hasPrefixCode
          && (current.code.startsWith(candidate.code) || candidate.code.startsWith(current.code)))) {
        related.push(candidate)
      }
    }
    for (const neighbor of [...explicit, ...related]) {
      queue.push(neighbor)
      seen.add(neighbor.pr.id)
      if (queue.length === limit) break
    }
  }
  return queue.map(item => item.pr)
}

function bindLocalItemEvidence(
  botItems: BatchAiReviewItem[],
  localItems: BatchAiReviewItem[],
): BatchAiReviewItem[] {
  const localItemsById = new Map(localItems.map(item => [item.prId, item]))
  return botItems.map((item) => {
    // Trusted offline evidence is server-owned advisory input. Never accept a
    // bot-authored replacement, and never use agreement to lower review gates.
    const botItem = { ...item }
    delete botItem.referenceEvidence
    const localItem = localItemsById.get(item.prId)
    const referenceEvidence = localItem?.referenceEvidence
    if (!referenceEvidence) return botItem

    if (referenceEvidence.validation !== 'mismatch') {
      return { ...botItem, referenceEvidence }
    }

    const reasons = [...botItem.reasons]
    const suggestions = [...botItem.suggestions]
    const mismatchReason = '离线参考读音均无法推出当前编码，请复核读音或编码。'
    const mismatchSuggestion = '对照参考读音与键道音码映射核对；参考一致也不能解除既有人工复核要求。'
    if (!reasons.includes(mismatchReason)) reasons.push(mismatchReason)
    if (!suggestions.includes(mismatchSuggestion)) suggestions.push(mismatchSuggestion)
    return {
      ...botItem,
      status: botItem.status === 'pass' ? 'attention' as const : botItem.status,
      severity: botItem.status === 'pass' ? 'warning' as const : botItem.severity,
      reasons,
      suggestions,
      referenceEvidence,
    }
  })
}

function bindLocalReferenceEvidence(
  botReview: BatchAiReviewResult,
  localReview: BatchAiReviewResult,
): BatchAiReviewResult {
  const items = bindLocalItemEvidence(botReview.items, localReview.items)
  const pass = items.filter(item => item.status === 'pass').length
  const attention = items.filter(item => item.status === 'attention').length
  const manualReview = items.filter(item => item.status === 'manual_review').length
  const localChains = new Map(
    localReview.codeChains.map(chain => [`${chain.type}:${chain.code}`, chain]),
  )
  const codeChains = botReview.codeChains.map((chain) => {
    const localChain = localChains.get(`${chain.type}:${chain.code}`)
    if (!localChain) return chain
    localChains.delete(`${chain.type}:${chain.code}`)
    return {
      ...chain,
      before: localChain.before,
      after: localChain.after,
      recommendations: [...new Set([...chain.recommendations, ...localChain.recommendations])],
    }
  })
  codeChains.push(...localChains.values())
  return {
    ...botReview,
    verdict: manualReview > 0 ? 'manual_review' : attention > 0 ? 'needs_attention' : 'pass',
    riskCounts: {
      pass,
      attention,
      manualReview,
      botReviewed: items.filter(item => item.reviewRecord).length,
    },
    items,
    codeChains,
  }
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

async function fetchMiaomiaoReview<T extends ItemReviewResult>(input: BotReviewInput, itemsOnly = false) {
  const controller = new AbortController()
  const timeoutMs = Math.min(
    Math.max(input.timeoutMs ?? MIAOMIAO_REVIEW_TIMEOUT_MS, 10_000),
    MIAOMIAO_REVIEW_TIMEOUT_MS,
  )
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  let response: Response
  try {
    const headers = new Headers(botReviewHeaders())
    if (itemsOnly) headers.set('X-KeyTao-Review-Output', 'items')
    response = await fetch(botReviewUrl(), {
      method: 'POST',
      headers,
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

  const data = await response.json().catch(() => ({})) as BotBatchReviewResponse<T>
  if (!response.ok || data.success === false || !Array.isArray(data.aiReview?.items)
    || typeof data.aiReview.generatedAt !== 'string') {
    throw new Error(data.detail || data.message || `喵喵复审服务返回 ${response.status}`)
  }

  return {
    aiReview: data.aiReview,
    warning: data.warning,
  }
}

export async function requestMiaomiaoBatchReviewDetailed(
  input: BotReviewInput & { localReview: BatchAiReviewResult },
): Promise<MiaomiaoBatchReviewResponse> {
  const result = await fetchMiaomiaoReview<BatchAiReviewResult>(input)
  return { ...result, aiReview: bindLocalReferenceEvidence(result.aiReview, input.localReview) }
}

export async function requestMiaomiaoItemReview(input: BotReviewInput): Promise<ItemReviewResult> {
  const { aiReview } = await fetchMiaomiaoReview<ItemReviewResult>(input, true)
  return { generatedAt: aiReview.generatedAt, items: bindLocalItemEvidence(aiReview.items, input.localReview.items) }
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
  aiReview: ItemReviewResult
  expectedContentVersion: number
}): Promise<void> {
  const reviewByPrId = new Map(input.aiReview.items.map(item => [item.prId, item]))
  const remarkUpdates: Array<{ id: number; remark: string }> = []

  for (const pr of input.batch.pullRequests) {
    if (pr.appliedAt) continue
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
        allowReviewMetadata: true,
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
  })
}
