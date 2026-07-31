import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => {
  const tx = {
    batch: {
      updateMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    pullRequest: {
      updateMany: vi.fn(),
    },
  }
  return {
    checkAdminPermission: vi.fn(),
    tx,
    prisma: {
      batch: { findUnique: vi.fn() },
      $transaction: vi.fn(),
    },
  }
})

vi.mock('@/lib/adminAuth', () => ({
  checkAdminPermission: mocks.checkAdminPermission,
}))

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))

function request() {
  return new NextRequest('http://localhost/api/admin/batches/batch-1/reject', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewNote: '目标不符合收录规则' }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.checkAdminPermission.mockResolvedValue({ authorized: true })
  mocks.prisma.batch.findUnique.mockResolvedValue({
    id: 'batch-1',
    status: 'Submitted',
    contentVersion: 7,
    pullRequests: [{ id: 1 }],
  })
  mocks.prisma.$transaction.mockImplementation(async (callback) => callback(mocks.tx))
  mocks.tx.batch.updateMany.mockResolvedValue({ count: 1 })
  mocks.tx.batch.findUniqueOrThrow.mockResolvedValue({ id: 'batch-1', status: 'Rejected' })
  mocks.tx.pullRequest.updateMany.mockResolvedValue({ count: 1 })
})

describe('POST /api/admin/batches/[id]/reject', () => {
  it('claims the submitted batch version before changing PR statuses', async () => {
    const { POST } = await import('./route')
    const response = await POST(request(), { params: Promise.resolve({ id: 'batch-1' }) })

    expect(response?.status).toBe(200)
    expect(mocks.tx.batch.updateMany).toHaveBeenCalledWith({
      where: { id: 'batch-1', status: 'Submitted', contentVersion: 7 },
      data: { status: 'Rejected', reviewNote: '目标不符合收录规则' },
    })
    expect(mocks.tx.batch.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.tx.pullRequest.updateMany.mock.invocationCallOrder[0],
    )
  })

  it('returns conflict without touching PRs when approval won the race', async () => {
    mocks.tx.batch.updateMany.mockResolvedValue({ count: 0 })
    const { POST } = await import('./route')
    const response = await POST(request(), { params: Promise.resolve({ id: 'batch-1' }) })

    expect(response?.status).toBe(409)
    expect(mocks.tx.pullRequest.updateMany).not.toHaveBeenCalled()
    expect(mocks.tx.batch.findUniqueOrThrow).not.toHaveBeenCalled()
  })
})
