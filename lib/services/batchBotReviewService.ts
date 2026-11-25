import { createHash } from 'node:crypto'
import { Prisma, type BatchStatus, type PullRequest } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { BatchAiReviewCodeChain, BatchAiReviewItem, BatchAiReviewResult } from '@/lib/types/batchAiReview'
import {
  getMiaomiaoSemanticEvidence,
  extractMiaomiaoReviewBlocks,
  MIAOMIAO_REVIEW_BLOCK_END,
  MIAOMIAO_REVIEW_BLOCK_START,
  parseMiaomiaoReviewRemark,
  readMiaomiaoSuggestedOrder,
  stripMiaomiaoReviewRemark,
} from './miaomiaoReviewRemark'
import {
  BatchContentLockedError,
  claimBatchContentMutation,
  EDITABLE_BATCH_STATUSES,
} from './batchContentGuard'

const REVIEWABLE_BATCH_STATUSES: readonly BatchStatus[] = [...EDITABLE_BATCH_STATUSES, 'Submitted']

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

export class MiaomiaoReviewRateLimitError extends Error {}

export function isMiaomiaoReviewRateLimit(message?: string): boolean {
  return typeof message === 'string' && /\b429\b|\brate[\s_-]*limit|限流|请求过于频繁/i.test(message)
}

type ItemReviewResult = Pick<BatchAiReviewResult, 'items' | 'generatedAt'> & {
  auditSealed?: boolean
  warning?: string
}

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
  ...targetIds: number[]
): T[] {
  const items = unappliedItems.map(pr => {
    const slotCode = (pr.code || pr.phrase?.code || '').toLowerCase()
    const code = slotCode.trim()
    const type = pr.type || 'Phrase'
    return {
      pr,
      word: (pr.word ?? pr.phrase?.word ?? '').trim(),
      oldWord: pr.action === 'Change' ? (pr.oldWord ?? '').trim() : '',
      type,
      code,
      slot: slotCode ? `${type}:${slotCode}` : '',
      hasPrefixCode: Array.from(code).length >= 3,
      linkedIds: new Set([
        ...(pr.dependencies ?? []).map(link => 'dependsOnId' in link ? link.dependsOnId : link.dependsOn.id),
        ...(pr.dependedBy ?? []).map(link => link.dependent.id),
      ]),
    }
  })
  const itemsById = new Map(items.map(item => [item.pr.id, item]))
  const targets = targetIds.map(id => itemsById.get(id)).filter(item => item !== undefined)
  const targetSlots = new Set(targets.map(item => item.slot).filter(Boolean))
  const slotItems = items.filter(item => targetSlots.has(item.slot))
  const required = new Map([...targets, ...slotItems].map(item => [item.pr.id, item.pr]))
  const candidates = items.filter(item => !required.has(item.pr.id))
  const closure = new Map<number, T>()

  // shortcut: Limit closure fill to 24 per target and 48 overall, revisit if related entries are frequently cut off.
  for (const target of targets) {
    const queue = [target, ...slotItems.filter(item => item !== target && item.slot === target.slot)]
    const limit = queue.length + 24
    const seen = new Set<number>()
    for (let index = 0; index < queue.length && queue.length < limit; index++) {
      const current = queue[index]
      const explicit = []
      const related = []
      for (const candidate of candidates) {
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
        closure.set(neighbor.pr.id, neighbor.pr)
        if (queue.length === limit) break
      }
    }
  }
  return [...required.values(), ...Array.from(closure.values()).slice(0, 48)]
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

  const data = (await response.json().catch(() => null) ?? {}) as BotBatchReviewResponse<T>
  if (!response.ok || data.success === false || !Array.isArray(data.aiReview?.items)
    || typeof data.aiReview.generatedAt !== 'string') {
    const message = data.detail || data.message || `喵喵复审服务返回 ${response.status}`
    if (response.status === 429 || isMiaomiaoReviewRateLimit(message)) {
      throw new MiaomiaoReviewRateLimitError(message)
    }
    throw new Error(message)
  }

  return {
    aiReview: data.aiReview,
    warning: data.warning,
    auditSealed: data.aiReview.auditSealed === true,
  }
}

export async function requestMiaomiaoBatchReviewDetailed(
  input: BotReviewInput & { localReview: BatchAiReviewResult },
): Promise<MiaomiaoBatchReviewResponse> {
  const { aiReview, warning } = await fetchMiaomiaoReview<BatchAiReviewResult>(input)
  return { warning, aiReview: bindLocalReferenceEvidence(aiReview, input.localReview) }
}

export async function requestMiaomiaoItemReview(input: BotReviewInput): Promise<ItemReviewResult> {
  const { aiReview, auditSealed, warning } = await fetchMiaomiaoReview<ItemReviewResult>(input, true)
  const items = aiReview.items.map(item => guardMiaomiaoItemPass(item, auditSealed))
  return { generatedAt: aiReview.generatedAt, auditSealed, warning, items: bindLocalItemEvidence(items, input.localReview.items) }
}

function isFallbackReviewItem(item: BatchAiReviewItem): boolean {
  return String(item.reviewRecord?.source) === 'bot-llm-fallback'
}

function guardMiaomiaoItemPass(item: BatchAiReviewItem, auditSealed?: boolean, ambiguousDigest = false): BatchAiReviewItem {
  if (item.status !== 'pass') return item
  const reason = auditSealed
    ? '本次复审含需人工确认的审计项，不能批量放行'
    : isFallbackReviewItem(item)
      ? '本次复审使用备用判断，不能批量放行'
      : ambiguousDigest ? '词条内容含校验分隔符，不能批量放行' : undefined
  return reason ? { ...item, status: 'attention', severity: 'warning', reasons: [reason, ...item.reasons] } : item
}

type ReviewContent = Pick<PullRequest, 'action' | 'word' | 'oldWord' | 'code' | 'type' | 'weight'>

export function computeReviewDigest(row: ReviewContent): string {
  const { action, word, oldWord, code, type, weight } = row
  return createHash('sha256')
    .update(`${action}|${word ?? ''}|${oldWord ?? ''}|${code ?? ''}|${type}|${weight ?? ''}`)
    .digest('hex').slice(0, 16)
}

export function mergeMiaomiaoReviewRemark(
  row: ReviewContent & { remark: string | null },
  changes: Partial<ReviewContent>,
  userRemark: string | null | undefined,
): string | null | undefined {
  const blocks = extractMiaomiaoReviewBlocks(row.remark)
  if (!blocks.length) return userRemark
  const next = {
    action: changes.action ?? row.action,
    word: changes.word === undefined ? row.word : changes.word,
    oldWord: changes.oldWord === undefined ? row.oldWord : changes.oldWord,
    code: changes.code === undefined ? row.code : changes.code,
    type: changes.type === undefined ? row.type : changes.type,
    weight: changes.weight === undefined ? row.weight : changes.weight,
  }
  const unchanged = computeReviewDigest(next) === computeReviewDigest(row)
  if (userRemark === undefined && unchanged) return undefined
  const base = userRemark === undefined ? stripMiaomiaoReviewRemark(row.remark) : userRemark
  return [base, ...(unchanged ? blocks : [])].filter(Boolean).join('\n\n') || null
}

export async function listMiaomiaoAutoReviewQueue(limit: number) {
  const now = Date.now()
  const quietBefore = new Date(now - 90_000)
  // shortcut: Use a fixed six-hour delay until per-item retry state is needed.
  const cooldownSince = now - 6 * 60 * 60 * 1000
  const blockPattern = `${MIAOMIAO_REVIEW_BLOCK_START}(.*?)${MIAOMIAO_REVIEW_BLOCK_END}`
  const digestWhitespace = ' \t\v\f\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u202f\u205f\u3000\ufeff'
  const pageSize = 200
  type QueueRow = ReviewContent & { id: number; batchId: string; remark: string | null; createAt: Date }
  let cursor: QueueRow | undefined
  let batchId: string | null = null
  const items: { prId: number; digest: string }[] = []
  while (items.length < limit) {
    // Match the remark parser and computeReviewDigest before LIMIT so fresh drafts cannot hide new work.
    const rows: QueueRow[] = await prisma.$queryRaw`
      SELECT pr.id, pr."batchId", pr."createAt", pr.remark, pr.action::text AS action, pr.word, pr."oldWord", pr.code, pr.type::text AS type, pr.weight
      FROM pull_requests pr
      JOIN batches batch ON batch.id = pr."batchId"
      WHERE pr."appliedAt" IS NULL AND pr."updateAt" <= ${quietBefore}
        AND (batch.status IN ('Draft', 'Rejected') OR (batch.status = 'Submitted' AND NOT batch."itemReviewStarted"))
        ${cursor ? Prisma.sql`AND (pr."createAt", pr.id) > (${cursor.createAt}, ${cursor.id})` : Prisma.empty}
        ${batchId ? Prisma.sql`AND pr."batchId" = ${batchId}` : Prisma.empty}
        AND (
          SELECT btrim((regexp_match(
            translate(review.block[1], ${'\r\u2028\u2029'}, ${'\n\n\n'}), '(?n)^校验[：:](.+)$'
          ))[1], ${digestWhitespace})
          FROM regexp_matches(pr.remark, ${blockPattern}, 'g') WITH ORDINALITY AS review(block, ordinal)
          ORDER BY review.ordinal DESC LIMIT 1
        ) IS DISTINCT FROM left(encode(sha256(convert_to(concat(
          pr.action, '|', pr.word, '|', pr."oldWord", '|', pr.code, '|', coalesce(pr.type::text, 'null'), '|', pr.weight
        ), 'UTF8')), 'hex'), 16)
      ORDER BY pr."createAt", pr.id
      LIMIT ${pageSize}
    `
    for (const row of rows) {
      if (batchId !== null && batchId !== row.batchId) continue
      const digest = computeReviewDigest(row)
      const { review } = parseMiaomiaoReviewRemark(row.remark)
      if (review?.reviewDigest === digest) continue
      const reviewedAt = Date.parse(review?.generatedAt ?? '')
      if (reviewedAt > cooldownSince && reviewedAt <= now) continue
      batchId = row.batchId
      items.push({ prId: row.id, digest })
      if (items.length === limit) break
    }
    if (rows.length < pageSize) break
    cursor = rows.at(-1)
  }
  return { batchId, items }
}

function statusText(item: BatchAiReviewItem): string {
  if (item.status === 'pass') return '通过'
  if (item.status === 'manual_review') return '需人工确认'
  return '需复核'
}

function replaceReviewBlockMarkers(value: string): string {
  return value.replaceAll(MIAOMIAO_REVIEW_BLOCK_START, '…').replaceAll(MIAOMIAO_REVIEW_BLOCK_END, '…')
}

function reviewLineValue(value: string): string {
  // Bot text belongs in field values, where it cannot introduce another block or status line.
  return replaceReviewBlockMarkers(value.replace(/[\r\n\u2028\u2029]+/g, ' '))
}

export function formatMiaomiaoReviewRemark(item: BatchAiReviewItem, generatedAt: string, reviewDigest?: string): string {
  const record = item.reviewRecord
  const lines = [
    MIAOMIAO_REVIEW_BLOCK_START,
    `本喵复审：${statusText(item)}`,
    `结论：${reviewLineValue(item.title)}`,
  ]

  const reasons = item.reasons.slice(0, 3).filter(Boolean).join('；')
  const suggestions = item.suggestions.slice(0, 3).filter(Boolean).join('；')
  if (reasons) {
    lines.push(`理由：${reviewLineValue(reasons)}`)
  }
  if (suggestions) {
    lines.push(`建议：${reviewLineValue(suggestions)}`)
  }
  if (record?.pronunciation) {
    lines.push(`读音：${reviewLineValue(record.pronunciation)}`)
  }
  const persistedSources = Array.from(new Set([
    ...(record?.sources ?? []),
    ...(record?.commonSenseSources ?? []),
  ].map(source => source.trim()).filter(Boolean)))
  // Always persist the field: an empty value is an explicit retraction of
  // legacy sources, while a missing field remains backward-compatible.
  lines.push(`来源：${reviewLineValue(persistedSources.join('、'))}`)
  for (const evidence of record ? getMiaomiaoSemanticEvidence(record).slice(0, 3) : []) {
    lines.push(`证据：${reviewLineValue(evidence)}`)
  }
  const { daily, authority } = record?.commonness ?? {}
  if (typeof daily === 'string' && daily) lines.push(`常用：${reviewLineValue(daily)}`)
  if (typeof authority === 'string' && authority) lines.push(`收录：${reviewLineValue(authority)}`)

  const suggestedOrder = readMiaomiaoSuggestedOrder(item.suggestedOrder)
  if (suggestedOrder) {
    // Escape remark delimiters as JSON characters so the values round-trip unchanged.
    const json = JSON.stringify(suggestedOrder)
      .replaceAll(MIAOMIAO_REVIEW_BLOCK_START, `\\u002d${MIAOMIAO_REVIEW_BLOCK_START.slice(1)}`)
      .replaceAll(MIAOMIAO_REVIEW_BLOCK_END, `\\u002d${MIAOMIAO_REVIEW_BLOCK_END.slice(1)}`)
      .replaceAll('\u2028', '\\u2028')
      .replaceAll('\u2029', '\\u2029')
    lines.push(`排序：${json}`)
  }
  lines.push(`时间：${reviewLineValue(generatedAt)}`)
  if (reviewDigest && !isFallbackReviewItem(item)) lines.push(`校验：${reviewDigest}`)
  lines.push(MIAOMIAO_REVIEW_BLOCK_END)
  return lines.join('\n')
}

export class StaleBatchReviewError extends Error {
  readonly status = 409

  constructor() {
    super('批次状态或内容在复审期间已发生变化，本次复审结果已作废，请重新发起复审')
    this.name = 'StaleBatchReviewError'
  }
}

const reviewWriteSelect = {
  id: true, remark: true, action: true, word: true, oldWord: true, code: true, type: true, weight: true,
} as const

function buildReviewRemark(
  row: ReviewContent & { remark: string | null },
  item: BatchAiReviewItem,
  review: ItemReviewResult,
  digest?: string,
): string {
  // The digest's field separator must not be mistaken for part of a different field.
  const ambiguousDigest = [row.word, row.oldWord, row.code].some(value => value?.includes('|'))
  return [
    replaceReviewBlockMarkers(stripMiaomiaoReviewRemark(row.remark)),
    formatMiaomiaoReviewRemark(guardMiaomiaoItemPass(item, review.auditSealed, ambiguousDigest), review.generatedAt, digest),
  ].filter(Boolean).join('\n\n')
}

export async function writeMiaomiaoItemReviewsByDigest(input: {
  batchId: string
  targetDigests: ReadonlyMap<number, string>
  aiReview: ItemReviewResult
}): Promise<{ reviewed: number[]; skipped: number[] }> {
  const { batchId, targetDigests, aiReview } = input
  const reviewByPrId = new Map(aiReview.items.map(item => [item.prId, item]))
  return prisma.$transaction(async (tx) => {
    // Match the author's batch-first lock order without claiming a content version.
    const [batch] = await tx.$queryRaw<{ status: BatchStatus; itemReviewStarted: boolean }[]>`
      SELECT status::text AS status, "itemReviewStarted" FROM batches WHERE id = ${batchId} FOR UPDATE
    `
    if (!batch || !REVIEWABLE_BATCH_STATUSES.includes(batch.status) || (batch.status === 'Submitted' && batch.itemReviewStarted)) {
      return { reviewed: [], skipped: Array.from(targetDigests.keys()) }
    }
    const rows = await tx.pullRequest.findMany({
      where: { id: { in: Array.from(targetDigests.keys()) }, batchId, appliedAt: null },
      select: reviewWriteSelect,
    })
    const rowsById = new Map(rows.map(row => [row.id, row]))
    const reviewed: number[] = []
    const skipped: number[] = []
    for (const [id, digest] of targetDigests) {
      const row = rowsById.get(id)
      if (!row || computeReviewDigest(row) !== digest) {
        skipped.push(id)
        continue
      }
      const item = reviewByPrId.get(id)
      const remark = buildReviewRemark(row, item ?? {
        prId: id,
        status: 'attention',
        severity: 'warning',
        title: '复审结果缺失',
        reasons: ['喵喵未返回该词条的结果'],
        suggestions: [],
      }, aiReview, item ? digest : undefined)
      const updated = await tx.pullRequest.updateMany({
        where: { ...row, batchId, appliedAt: null },
        data: { remark },
      })
      if (updated.count === 1) reviewed.push(id)
      else skipped.push(id)
    }
    return { reviewed, skipped }
  })
}

export async function writeMiaomiaoBatchReview(input: {
  batch: ReviewableBatch
  aiReview: ItemReviewResult
  expectedContentVersion: number
}): Promise<void> {
  const reviewByPrId = new Map(input.aiReview.items.map(item => [item.prId, item]))
  const targetIds = input.batch.pullRequests
    .filter(pr => !pr.appliedAt && reviewByPrId.has(pr.id))
    .map(pr => pr.id)

  await prisma.$transaction(async (tx) => {
    try {
      await claimBatchContentMutation(tx, input.batch.id, {
        expectedContentVersion: input.expectedContentVersion,
        allowedStatuses: REVIEWABLE_BATCH_STATUSES,
        allowReviewMetadata: true,
      })
    } catch (error) {
      if (error instanceof BatchContentLockedError) throw new StaleBatchReviewError()
      throw error
    }

    const rows = await tx.pullRequest.findMany({
      where: { id: { in: targetIds }, batchId: input.batch.id, appliedAt: null },
      select: reviewWriteSelect,
    })
    if (rows.length !== targetIds.length) throw new StaleBatchReviewError()

    for (const row of rows) {
      const remark = buildReviewRemark(row, reviewByPrId.get(row.id)!, input.aiReview, computeReviewDigest(row))
      const updated = await tx.pullRequest.updateMany({
        where: { id: row.id, batchId: input.batch.id, appliedAt: null },
        data: { remark },
      })
      if (updated.count !== 1) throw new StaleBatchReviewError()
    }
  })
}
