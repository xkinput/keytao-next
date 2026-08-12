import { describe, expect, it, vi } from 'vitest'
import {
  formatMiaomiaoReviewRemark,
  requestMiaomiaoBatchReviewDetailed,
  StaleBatchReviewError,
} from './batchBotReviewService'

describe('StaleBatchReviewError', () => {
  it('describes both status transitions and content edits during review', () => {
    const error = new StaleBatchReviewError()

    expect(error).toBeInstanceOf(StaleBatchReviewError)
    expect(error).toMatchObject({
      name: 'StaleBatchReviewError',
      status: 409,
    })
    expect(error.message).toBe(
      '批次状态或内容在复审期间已发生变化，本次复审结果已作废，请重新发起复审',
    )
  })
})

describe('formatMiaomiaoReviewRemark', () => {
  it('always emits the source field so an empty list retracts legacy sources', () => {
    const remark = formatMiaomiaoReviewRemark({
      prId: 1,
      status: 'pass',
      severity: 'success',
      title: '旧来源已撤回',
      reasons: [],
      suggestions: [],
      reviewRecord: {
        reviewedBy: 'Miaomiao',
        source: 'bot-llm',
        summary: '旧来源已撤回',
        sources: [],
        authoritySources: [],
        commonSenseSources: [],
        evidence: [],
      },
    }, '2026-08-05T00:00:00.000Z')

    expect(remark).toContain('\n来源：\n')
  })

  it('persists derived common-sense sources even beyond the evidence cap', () => {
    const remark = formatMiaomiaoReviewRemark({
      prId: 1,
      status: 'pass',
      severity: 'success',
      title: '常识依据充分',
      reasons: [],
      suggestions: [],
      reviewRecord: {
        reviewedBy: 'Miaomiao',
        source: 'bot-llm',
        summary: '常识依据充分',
        sources: [],
        authoritySources: [],
        commonSenseSources: ['语言常识'],
        evidence: ['证据一', '证据二', '证据三', '本喵语言常识：该词大众通行。'],
      },
    }, '2026-08-05T00:00:00.000Z')

    expect(remark).toContain('\n来源：语言常识\n')
    expect(remark).not.toContain('证据：本喵语言常识：该词大众通行。')
  })
})

describe('requestMiaomiaoBatchReviewDetailed reference binding', () => {
  it('keeps a server-owned reference mismatch advisory when the bot returns pass', async () => {
    const localReview = {
      reviewer: 'Miaomiao' as const,
      generatedAt: '2026-08-12T00:00:00.000Z',
      verdict: 'needs_attention' as const,
      headline: '需复核',
      suggestedReviewNote: '需复核',
      riskCounts: { pass: 0, attention: 1, manualReview: 0, botReviewed: 0 },
      checklist: [],
      items: [{
        prId: 1,
        status: 'attention' as const,
        severity: 'warning' as const,
        title: '参考读音不一致',
        reasons: ['离线参考读音均无法推出当前编码，请复核读音或编码。'],
        suggestions: ['对照参考读音与键道音码映射核对；参考一致也不能解除既有人工复核要求。'],
        referenceEvidence: {
          dictionaryPresent: true,
          frequency: 88,
          validation: 'mismatch' as const,
          readings: [{ reading: 'ān pò', sources: ['汉典（离线数据集）'], codeConsistent: false }],
          line: '参考读音：ān pò（汉典（离线数据集）；编码不一致）；语料频次：88。',
        },
      }],
      codeChains: [{
        code: 'xfbl',
        type: 'Phrase' as const,
        before: [],
        after: [],
        recommendations: ['语料频次不支持提频。'],
      }],
    }
    const botReview = {
      ...localReview,
      verdict: 'pass' as const,
      codeChains: [],
      items: [{
        ...localReview.items[0],
        status: 'pass' as const,
        severity: 'success' as const,
        reasons: ['机器人认为可通过。'],
        suggestions: [],
        referenceEvidence: {
          ...localReview.items[0].referenceEvidence,
          validation: 'match' as const,
        },
      }],
    }
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, aiReview: botReview }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await requestMiaomiaoBatchReviewDetailed({
      batch: { id: 'batch-1', status: 'Submitted', pullRequests: [{ id: 1, remark: null }] },
      localReview,
    })

    expect(result.aiReview.items[0]).toMatchObject({
      status: 'attention',
      severity: 'warning',
      referenceEvidence: { validation: 'mismatch', frequency: 88 },
    })
    expect(result.aiReview.verdict).toBe('needs_attention')
    expect(result.aiReview.riskCounts).toMatchObject({ pass: 0, attention: 1, manualReview: 0 })
    expect(result.aiReview.codeChains[0].recommendations).toContain('语料频次不支持提频。')
    expect(result.aiReview.items[0].reasons).toContain(
      '离线参考读音均无法推出当前编码，请复核读音或编码。',
    )
  })
})
