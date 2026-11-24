import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'

const { recordItemReview } = vi.hoisted(() => ({ recordItemReview: vi.fn() }))

vi.mock('@/lib/adminAuth', () => ({
  checkAdminPermission: vi.fn().mockResolvedValue({ authorized: true, session: { id: 7 } }),
}))
vi.mock('@/lib/services/batchItemReview', () => ({
  recordItemReview,
  ItemReviewError: class extends Error {},
}))

function review(body: Record<string, unknown>) {
  return POST(new NextRequest('http://localhost/api/admin/batches/batch-id/items/12/review', {
    method: 'POST',
    body: JSON.stringify({ expectedContentVersion: 4, ...body }),
  }), { params: Promise.resolve({ id: 'batch-id', itemId: '12' }) })
}

describe('item review reasons', () => {
  beforeEach(() => {
    recordItemReview.mockReset().mockResolvedValue({ id: 12 })
  })

  it('allows a signed approval with no reason', async () => {
    const response = await review({ decision: 'Approved' })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ contentVersion: 5 })
    expect(recordItemReview).toHaveBeenCalledWith({
      batchId: 'batch-id', itemId: 12, reviewerId: 7, expectedContentVersion: 4,
      decision: 'Approved', reason: '',
    })
  })

  it.each([undefined, '', ' \n　 '])('rejects a rejection with reason %j', async reason => {
    const response = await review({ decision: 'Rejected', reason })

    expect(response.status).toBe(400)
    expect(recordItemReview).not.toHaveBeenCalled()
  })

  it('preserves a trimmed reason on the signed rejection', async () => {
    const response = await review({ decision: 'Rejected', reason: '  需补出处  ' })

    expect(response.status).toBe(200)
    expect(recordItemReview).toHaveBeenCalledWith(expect.objectContaining({
      decision: 'Rejected', reason: '需补出处', reviewerId: 7,
    }))
  })
})
