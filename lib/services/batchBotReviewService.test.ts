import { describe, expect, it } from 'vitest'
import { StaleBatchReviewError } from './batchBotReviewService'

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
