import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => {
  const tx = {
    batch: {
      updateMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
  }
  return {
    getSession: vi.fn(),
    tx,
    prisma: {
      batch: { findUnique: vi.fn() },
      $transaction: vi.fn(),
    },
  }
})

vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getSession.mockResolvedValue({ id: 1 })
  mocks.prisma.batch.findUnique.mockResolvedValue({
    id: 'batch-1',
    creatorId: 1,
    status: 'Submitted',
    contentVersion: 4,
  })
  mocks.prisma.$transaction.mockImplementation(async (callback) => callback(mocks.tx))
  mocks.tx.batch.updateMany.mockResolvedValue({ count: 1 })
  mocks.tx.batch.findUniqueOrThrow.mockResolvedValue({ id: 'batch-1', status: 'Draft' })
})

describe('POST /api/batches/[id]/withdraw', () => {
  it('withdraws only the exact submitted snapshot', async () => {
    const { POST } = await import('./route')
    const response = await POST(new NextRequest('http://localhost'), {
      params: Promise.resolve({ id: 'batch-1' }),
    })

    expect(response.status).toBe(200)
    expect(mocks.tx.batch.updateMany).toHaveBeenCalledWith({
      where: { id: 'batch-1', creatorId: 1, status: 'Submitted', contentVersion: 4 },
      data: { status: 'Draft' },
    })
  })

  it('does not undo an approval that won the race', async () => {
    mocks.tx.batch.updateMany.mockResolvedValue({ count: 0 })
    const { POST } = await import('./route')
    const response = await POST(new NextRequest('http://localhost'), {
      params: Promise.resolve({ id: 'batch-1' }),
    })

    expect(response.status).toBe(409)
    expect(mocks.tx.batch.findUniqueOrThrow).not.toHaveBeenCalled()
  })
})
