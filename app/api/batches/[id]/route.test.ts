import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  checkIsAdmin: vi.fn(),
  prisma: {
    batch: {
      findUnique: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}))

vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/adminAuth', () => ({ checkIsAdmin: mocks.checkIsAdmin }))
vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('@/lib/services/batchAiReviewService', () => ({ buildBatchAiReview: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getSession.mockResolvedValue({ id: 1 })
  mocks.checkIsAdmin.mockResolvedValue(false)
  mocks.prisma.batch.findUnique.mockResolvedValue({
    id: 'batch-1',
    creatorId: 1,
    status: 'Draft',
    contentVersion: 9,
  })
  mocks.prisma.batch.deleteMany.mockResolvedValue({ count: 1 })
})

describe('DELETE /api/batches/[id]', () => {
  it('deletes only the exact editable owner snapshot', async () => {
    const { DELETE } = await import('./route')
    const response = await DELETE(new NextRequest('http://localhost'), {
      params: Promise.resolve({ id: 'batch-1' }),
    })

    expect(response.status).toBe(200)
    expect(mocks.prisma.batch.deleteMany).toHaveBeenCalledWith({
      where: {
        id: 'batch-1',
        creatorId: 1,
        status: { in: ['Draft', 'Rejected'] },
        contentVersion: 9,
      },
    })
  })

  it('does not delete a batch that was submitted concurrently', async () => {
    mocks.prisma.batch.deleteMany.mockResolvedValue({ count: 0 })
    const { DELETE } = await import('./route')
    const response = await DELETE(new NextRequest('http://localhost'), {
      params: Promise.resolve({ id: 'batch-1' }),
    })

    expect(response.status).toBe(409)
  })
})
