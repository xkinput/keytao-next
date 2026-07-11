import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BatchAiReviewResult } from '@/lib/types/batchAiReview'
import type { BatchConflictResult } from './batchConflictService'

const mocks = vi.hoisted(() => ({
  checkBatchConflictsWithWeight: vi.fn(),
  buildBatchSubmitWarnings: vi.fn(),
  buildSkippedCandidateSlotWarnings: vi.fn(),
  buildPriorityOrderWarnings: vi.fn(),
  buildBatchAiReview: vi.fn(),
  requestMiaomiaoBatchReviewDetailed: vi.fn(),
}))

vi.mock('./batchConflictService', () => ({
  checkBatchConflictsWithWeight: mocks.checkBatchConflictsWithWeight,
}))
vi.mock('./batchSubmitWarnings', () => ({
  buildBatchSubmitWarnings: mocks.buildBatchSubmitWarnings,
}))
vi.mock('./batchSkippedCodeWarnings', () => ({
  buildSkippedCandidateSlotWarnings: mocks.buildSkippedCandidateSlotWarnings,
}))
vi.mock('./batchPriorityOrderWarnings', () => ({
  buildPriorityOrderWarnings: mocks.buildPriorityOrderWarnings,
}))
vi.mock('./batchAiReviewService', () => ({
  buildBatchAiReview: mocks.buildBatchAiReview,
}))
vi.mock('./batchBotReviewService', () => ({
  requestMiaomiaoBatchReviewDetailed: mocks.requestMiaomiaoBatchReviewDetailed,
}))

import { classifyPreSubmitRecommendation, reviewPreSubmitBatch } from './preSubmitReviewService'

function review(verdict: BatchAiReviewResult['verdict']): BatchAiReviewResult {
  const status = verdict === 'pass' ? 'pass' : verdict === 'manual_review' ? 'manual_review' : 'attention'
  return {
    reviewer: 'Miaomiao',
    generatedAt: '2026-07-11T00:00:00.000Z',
    verdict,
    headline: verdict === 'pass' ? '检查通过' : '需要复核',
    suggestedReviewNote: '审词建议',
    riskCounts: {
      pass: status === 'pass' ? 1 : 0,
      attention: status === 'attention' ? 1 : 0,
      manualReview: status === 'manual_review' ? 1 : 0,
      botReviewed: 1,
    },
    checklist: [],
    items: [{
      prId: 1,
      status,
      severity: status === 'pass' ? 'success' : status === 'manual_review' ? 'danger' : 'warning',
      title: verdict === 'pass' ? '可提交' : '需要复核',
      reasons: ['测试理由'],
      suggestions: ['测试建议'],
    }],
    codeChains: [],
  }
}

function conflict(hasConflict: boolean): BatchConflictResult {
  return {
    id: 'field-1',
    conflict: {
      hasConflict,
      code: 'pgtk',
      impact: hasConflict ? '词条重复' : undefined,
      suggestions: hasConflict
        ? [{ action: 'Cancel', word: '平替', reason: '请移除重复项' }]
        : [],
    },
    calculatedWeight: 100,
  }
}

const item = {
  id: 'field-1',
  action: 'Create' as const,
  word: '平替',
  code: 'pgtk',
  type: 'Phrase' as const,
  remark: '用于替代原方案',
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.checkBatchConflictsWithWeight.mockResolvedValue([conflict(false)])
  mocks.buildBatchSubmitWarnings.mockReturnValue([])
  mocks.buildSkippedCandidateSlotWarnings.mockResolvedValue([])
  mocks.buildPriorityOrderWarnings.mockResolvedValue([])
  mocks.buildBatchAiReview.mockResolvedValue(review('needs_attention'))
  mocks.requestMiaomiaoBatchReviewDetailed.mockResolvedValue({ aiReview: review('pass') })
})

describe('pre-submit review service', () => {
  it('blocks hard conflicts without spending an LLM request', async () => {
    mocks.checkBatchConflictsWithWeight.mockResolvedValue([conflict(true)])

    const result = await reviewPreSubmitBatch([item])

    expect(result.recommendation).toBe('blocked')
    expect(result.canSubmit).toBe(false)
    expect(result.blockers).toEqual(['field-1'])
    expect(result.reviewSource).toBe('local_rules')
    expect(mocks.requestMiaomiaoBatchReviewDetailed).not.toHaveBeenCalled()
  })

  it('returns ready only after a complete Bot LLM pass', async () => {
    const result = await reviewPreSubmitBatch([item])

    expect(result.recommendation).toBe('ready')
    expect(result.reviewSource).toBe('bot_llm')
    expect(result.reviewItemIds).toEqual({ '1': 'field-1' })
    expect(mocks.requestMiaomiaoBatchReviewDetailed).toHaveBeenCalledWith(expect.objectContaining({
      batch: expect.objectContaining({
        status: 'Draft',
        pullRequests: [expect.objectContaining({ remark: '用于替代原方案', code: 'pgtk' })],
      }),
    }))
  })

  it('allows submission but asks for confirmation when the Bot requests manual review', async () => {
    mocks.requestMiaomiaoBatchReviewDetailed.mockResolvedValue({ aiReview: review('manual_review') })

    const result = await reviewPreSubmitBatch([item])

    expect(result.recommendation).toBe('confirm')
    expect(result.canSubmit).toBe(true)
    expect(result.review.verdict).toBe('manual_review')
  })

  it('falls back to deterministic review when the Bot request fails', async () => {
    mocks.requestMiaomiaoBatchReviewDetailed.mockRejectedValue(new Error('Bot timeout'))

    const result = await reviewPreSubmitBatch([item])

    expect(result.recommendation).toBe('confirm')
    expect(result.canSubmit).toBe(true)
    expect(result.reviewSource).toBe('local_fallback')
    expect(result.reviewError).toBe('Bot timeout')
    expect(result.review.verdict).toBe('needs_attention')
  })

  it('never treats a local fallback pass as fully ready', () => {
    expect(classifyPreSubmitRecommendation({
      hasHardConflict: false,
      review: review('pass'),
      reviewSource: 'local_fallback',
    })).toBe('confirm')
  })
})
