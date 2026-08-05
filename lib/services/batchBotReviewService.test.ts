import { describe, expect, it } from 'vitest'
import { formatMiaomiaoReviewRemark, StaleBatchReviewError } from './batchBotReviewService'

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
