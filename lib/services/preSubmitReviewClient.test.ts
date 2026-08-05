import { describe, expect, it } from 'vitest'
import type { BatchAiReviewResult } from '@/lib/types/batchAiReview'
import type { PreSubmitReviewResponse } from '@/lib/types/preSubmitReview'
import {
  buildPreSubmitFingerprint,
  buildPreSubmitReviewItems,
  formatPreSubmitReviewWarning,
  mapReviewItemsByFieldId,
} from './preSubmitReviewClient'

const formItem = {
  action: 'Create' as const,
  word: '平替',
  oldWord: '',
  code: 'pgtk',
  type: 'Phrase',
  weight: '100',
  remark: '常用网络词',
}

function review(): BatchAiReviewResult {
  return {
    reviewer: 'Miaomiao',
    generatedAt: '2026-07-11T00:00:00.000Z',
    verdict: 'needs_attention',
    headline: '1 项建议确认后提交。',
    suggestedReviewNote: '建议确认',
    riskCounts: { pass: 0, attention: 1, manualReview: 0, botReviewed: 1 },
    checklist: [],
    items: [{
      prId: 1,
      status: 'attention',
      severity: 'warning',
      title: '同码链顺序待确认',
      reasons: ['常用度证据不足'],
      suggestions: ['确认后提交'],
    }],
    codeChains: [],
  }
}

function response(): PreSubmitReviewResponse {
  return {
    results: [],
    warnings: [],
    review: review(),
    reviewSource: 'bot_llm',
    recommendation: 'confirm',
    canSubmit: true,
    blockers: [],
    reviewItemIds: { '1': 'field-1' },
  }
}

describe('pre-submit review client helpers', () => {
  it('reviews only the user remark when an existing server review block is round-tripped', () => {
    const remark = [
      '管理员更新备注',
      '',
      '--- miao-review:start ---',
      '本喵复审：需人工确认',
      '来源：汉典',
      '--- miao-review:end ---',
    ].join('\n')

    expect(buildPreSubmitReviewItems([{ ...formItem, remark }], ['field-1'])[0]?.remark)
      .toBe('管理员更新备注')
  })

  it('invalidates an old review when review-relevant form data changes', () => {
    const original = buildPreSubmitReviewItems([formItem], ['field-1'])
    const changedCode = buildPreSubmitReviewItems([{ ...formItem, code: 'pgtkv' }], ['field-1'])
    const changedRemark = buildPreSubmitReviewItems([{ ...formItem, remark: '补充用途' }], ['field-1'])

    expect(buildPreSubmitFingerprint(changedCode)).not.toBe(buildPreSubmitFingerprint(original))
    expect(buildPreSubmitFingerprint(changedRemark)).not.toBe(buildPreSubmitFingerprint(original))
  })

  it('ignores cosmetic whitespace and code casing in fingerprints', () => {
    const original = buildPreSubmitReviewItems([formItem], ['field-1'])
    const cosmetic = buildPreSubmitReviewItems([{
      ...formItem,
      word: ' 平替 ',
      code: 'PGTK',
      remark: ' 常用网络词 ',
    }], ['field-1'])

    expect(buildPreSubmitFingerprint(cosmetic)).toBe(buildPreSubmitFingerprint(original))
  })

  it('maps Bot review ids back to the exact client field', () => {
    expect(mapReviewItemsByFieldId(response()).get('field-1')?.title).toBe('同码链顺序待确认')
  })

  it('formats a concise manual confirmation warning', () => {
    const items = buildPreSubmitReviewItems([formItem], ['field-1'])
    const warning = formatPreSubmitReviewWarning(response(), items)

    expect(warning).toContain('#1 同码链顺序待确认')
    expect(warning).toContain('可提交，但需管理员确认')
    expect(warning).not.toContain('提交后')
    expect(warning).not.toContain('等待管理员')
  })

  it('keeps fallback review status direct and non-temporal', () => {
    const items = buildPreSubmitReviewItems([formItem], ['field-1'])
    const warning = formatPreSubmitReviewWarning({
      ...response(),
      reviewSource: 'local_fallback',
      reviewError: '服务超时',
    }, items)

    expect(warning).toContain('完整审词暂未完成：服务超时')
    expect(warning).toContain('该批次可提交，但需管理员审核')
    expect(warning).not.toContain('提交后')
    expect(warning).not.toContain('等待管理员')
  })
})
