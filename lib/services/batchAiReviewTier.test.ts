import { describe, expect, it, vi } from 'vitest'
import { buildBatchAiReviewItems, deriveBatchReviewTier } from './batchAiReviewService'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    pronunciationReference: { findMany: vi.fn().mockResolvedValue([]) },
    corpusFrequency: { findMany: vi.fn().mockResolvedValue([]) },
  },
}))

const votes = { likedBy: 1, dislikedBy: 1 }
const create = { action: 'Create', _count: votes }

describe('deriveBatchReviewTier', () => {
  it('puts every manual signal ahead of a passing review or missing review', () => {
    expect(deriveBatchReviewTier(create, 'manual_review', false)).toBe('manual')
    expect(deriveBatchReviewTier({ ...create, needsManualReview: true }, undefined, false)).toBe('manual')
    expect(deriveBatchReviewTier({ ...create, hasConflict: true, conflictInfo: { hasConflict: false } }, 'pass', false)).toBe('manual')
    expect(deriveBatchReviewTier({ ...create, conflictInfo: { hasConflict: true } }, 'pass', false)).toBe('manual')
  })

  it('requires a pass, an eligible action, and at least as many likes as dislikes', () => {
    expect(deriveBatchReviewTier(create, 'pass', false)).toBe('safe')
    expect(deriveBatchReviewTier({ ...create, action: 'Delete' }, 'pass', true)).toBe('safe')
    expect(deriveBatchReviewTier({ ...create, action: 'Delete' }, 'pass', false)).toBe('look')
    expect(deriveBatchReviewTier({ ...create, action: 'Change' }, 'pass', true)).toBe('look')
    expect(deriveBatchReviewTier({ ...create, _count: { ...votes, dislikedBy: 2 } }, 'pass', false)).toBe('look')
    expect(deriveBatchReviewTier(create, 'attention', false)).toBe('look')
    expect(deriveBatchReviewTier(create, undefined, false)).toBe('look')
  })
})

describe('structured Miaomiao status in the item review', () => {
  it.each([
    ['不通过', 'manual_review', 'manual'],
    ['通过，需人工确认', 'manual_review', 'manual'],
    ['通过', 'pass', 'safe'],
    ['通过待定', 'attention', 'look'],
  ])('reads %s as %s', async (remarkStatus, status, tier) => {
    const items = await buildBatchAiReviewItems([{
      ...create,
      id: 1,
      word: '安波',
      code: 'xfbl',
      weight: null,
      remark: `--- miao-review:start ---\n本喵复审：${remarkStatus}\n--- miao-review:end ---`,
    }])
    expect(items[0]).toMatchObject({ status, tier })
  })

  it('requires a bot review to put the delete side of a detected code move in the safe tier', async () => {
    const common = { word: '安波', weight: null, remark: null, _count: votes }
    const insert = { ...common, id: 1, action: 'Create', code: 'xfbl' }
    const remove = { ...common, id: 2, action: 'Delete', code: 'xfba' }
    const reviewed = { ...remove, remark: '--- miao-review:start ---\n本喵复审：通过\n--- miao-review:end ---' }
    const [, unreviewedMove] = await buildBatchAiReviewItems([insert, remove])
    const [, reviewedMove] = await buildBatchAiReviewItems([insert, reviewed])
    const [pureDelete] = await buildBatchAiReviewItems([reviewed])
    expect(unreviewedMove.tier).toBe('look')
    expect(reviewedMove.tier).toBe('safe')
    expect(pureDelete.tier).toBe('manual')
  })
})
