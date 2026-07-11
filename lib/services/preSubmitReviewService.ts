import { checkBatchConflictsWithWeight, type BatchConflictResult } from './batchConflictService'
import { buildBatchSubmitWarnings, type BatchSubmitWarning } from './batchSubmitWarnings'
import { buildSkippedCandidateSlotWarnings } from './batchSkippedCodeWarnings'
import { buildPriorityOrderWarnings } from './batchPriorityOrderWarnings'
import { buildBatchAiReview } from './batchAiReviewService'
import { requestMiaomiaoBatchReviewDetailed } from './batchBotReviewService'
import type {
  PreSubmitRecommendation,
  PreSubmitReviewItem,
  PreSubmitReviewResponse,
  PreSubmitReviewSource,
} from '@/lib/types/preSubmitReview'
import type { BatchAiReviewResult } from '@/lib/types/batchAiReview'

function isUnresolvedConflict(result: BatchConflictResult): boolean {
  const isResolved = result.conflict.suggestions?.some(suggestion => suggestion.action === 'Resolved')
  return result.conflict.hasConflict && !isResolved
}

export function classifyPreSubmitRecommendation(input: {
  hasHardConflict: boolean
  review: BatchAiReviewResult
  reviewSource: PreSubmitReviewSource
}): PreSubmitRecommendation {
  if (input.hasHardConflict) return 'blocked'
  if (input.reviewSource !== 'bot_llm') return 'confirm'
  return input.review.verdict === 'pass' ? 'ready' : 'confirm'
}

function preSubmitReviewTimeoutMs(): number {
  const configured = Number(process.env.PRE_SUBMIT_MIAOMIAO_REVIEW_TIMEOUT_MS || 180_000)
  if (!Number.isFinite(configured)) return 180_000
  return Math.min(Math.max(configured, 10_000), 240_000)
}

export async function reviewPreSubmitBatch(items: PreSubmitReviewItem[]): Promise<PreSubmitReviewResponse> {
  const [results, skippedSlotWarnings, priorityWarnings] = await Promise.all([
    checkBatchConflictsWithWeight(items),
    buildSkippedCandidateSlotWarnings(items),
    buildPriorityOrderWarnings(items),
  ])
  const warnings: BatchSubmitWarning[] = [
    ...buildBatchSubmitWarnings(items, results),
    ...skippedSlotWarnings,
    ...priorityWarnings,
  ]

  const resultById = new Map(results.map(result => [result.id, result]))
  const blockers = results.filter(isUnresolvedConflict).map(result => result.id)
  const reviewItemIds: Record<string, string> = {}
  const pullRequests = items.map((item, index) => {
    const prId = index + 1
    reviewItemIds[String(prId)] = item.id
    const result = resultById.get(item.id)
    const hardConflict = result ? isUnresolvedConflict(result) : false
    const conflictInfo = result?.conflict
      ? { ...result.conflict, hasConflict: hardConflict }
      : null

    return {
      id: prId,
      action: item.action,
      word: item.word.trim(),
      oldWord: item.oldWord?.trim() || null,
      code: item.code.trim().toLowerCase(),
      type: item.type || 'Phrase',
      weight: item.weight ?? result?.calculatedWeight ?? null,
      remark: item.remark?.trim() || null,
      hasConflict: hardConflict,
      conflictReason: hardConflict ? result?.conflict.impact || '存在未解决冲突' : null,
      conflictInfo,
    }
  })
  const batch = {
    id: 'pre-submit',
    status: 'Draft',
    description: '用户提交前审词',
    reviewNote: null,
    pullRequests,
  }
  const localReview = await buildBatchAiReview(batch)

  let review = localReview
  let reviewSource: PreSubmitReviewSource = 'local_rules'
  let reviewError: string | undefined

  if (blockers.length > 0) {
    reviewError = '存在未解决的硬冲突，处理后再进行完整审词。'
  } else {
    try {
      const botReview = await requestMiaomiaoBatchReviewDetailed({
        batch,
        localReview,
        timeoutMs: preSubmitReviewTimeoutMs(),
      })
      review = botReview.aiReview
      reviewSource = botReview.warning ? 'local_fallback' : 'bot_llm'
      reviewError = botReview.warning
    } catch (error) {
      reviewSource = 'local_fallback'
      reviewError = error instanceof Error ? error.message : '喵喵完整审词暂时不可用'
    }
  }

  const recommendation = classifyPreSubmitRecommendation({
    hasHardConflict: blockers.length > 0,
    review,
    reviewSource,
  })

  return {
    results,
    warnings,
    review,
    reviewSource,
    reviewError,
    recommendation,
    canSubmit: recommendation !== 'blocked',
    blockers,
    reviewItemIds,
  }
}
