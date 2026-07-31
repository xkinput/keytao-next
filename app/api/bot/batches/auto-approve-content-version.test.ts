import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mockRequireVerifiedBotUser = vi.fn()
const mockFindUnique = vi.fn()
const mockApprove = vi.fn()

vi.mock('@/lib/botUserAuth', () => ({ requireVerifiedBotUser: mockRequireVerifiedBotUser }))
vi.mock('@/lib/prisma', () => ({ prisma: { batch: { findUnique: mockFindUnique } } }))
vi.mock('@/lib/services/batchApprovalService', () => ({
  approveSubmittedBatch: mockApprove,
  classifyBatchDeleteRisk: vi.fn(() => ({ hasBareDelete: false, bareDeletes: [] })),
  BatchConcurrentUpdateError: class BatchConcurrentUpdateError extends Error { status = 409 },
}))

function request(body: unknown) {
  return new NextRequest('http://localhost/api/bot/batches/batch-1/auto-approve', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireVerifiedBotUser.mockResolvedValue({ authorized: true, user: { id: 42 } })
  mockFindUnique.mockResolvedValue({
    id: 'batch-1', creatorId: 42, status: 'Submitted', contentVersion: 5, pullRequests: [],
  })
  mockApprove.mockResolvedValue({ batch: { id: 'batch-1', status: 'Approved' } })
})

describe('bot auto approve content snapshot', () => {
  it('requires expectedContentVersion and passes it into the approval service', async () => {
    const { POST } = await import('./[id]/auto-approve/route')
    const missing = await POST(request({ platform: 'qq', platformId: 'u-1' }), {
      params: Promise.resolve({ id: 'batch-1' }),
    })
    expect(missing.status).toBe(400)

    const ok = await POST(request({ platform: 'qq', platformId: 'u-1', expectedContentVersion: 5 }), {
      params: Promise.resolve({ id: 'batch-1' }),
    })
    expect(ok.status).toBe(200)
    expect(mockApprove).toHaveBeenCalledWith(expect.objectContaining({ expectedContentVersion: 5 }))
  })
})
