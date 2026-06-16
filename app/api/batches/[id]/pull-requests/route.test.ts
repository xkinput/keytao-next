import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => {
  const tx = {
    pullRequest: {
      deleteMany: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
    },
    phrase: {
      findFirst: vi.fn(),
    },
  }

  return {
    getSession: vi.fn(),
    checkIsAdmin: vi.fn(),
    checkConflict: vi.fn(),
    calculateWeightForType: vi.fn(),
    tx,
    prisma: {
      batch: {
        findUnique: vi.fn(),
      },
      phrase: {
        findMany: vi.fn(),
      },
      $transaction: vi.fn(),
    },
  }
})

vi.mock('@/lib/auth', () => ({
  getSession: mocks.getSession,
}))

vi.mock('@/lib/adminAuth', () => ({
  checkIsAdmin: mocks.checkIsAdmin,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

vi.mock('@/lib/services/conflictDetector', () => ({
  conflictDetector: {
    checkConflict: mocks.checkConflict,
  },
}))

vi.mock('@/lib/services/batchConflictService', () => ({
  calculateWeightForType: mocks.calculateWeightForType,
}))

function putRequest(body: unknown) {
  return new NextRequest('http://localhost/api/batches/batch-1/pull-requests', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getSession.mockResolvedValue({ id: 1, name: 'admin' })
  mocks.checkIsAdmin.mockResolvedValue(true)
  mocks.checkConflict.mockResolvedValue({ hasConflict: false, suggestions: [] })
  mocks.calculateWeightForType.mockReturnValue(100)
  mocks.prisma.batch.findUnique.mockResolvedValue({
    id: 'batch-1',
    creatorId: 2,
    status: 'Submitted',
    pullRequests: [{ id: 10 }],
  })
  mocks.prisma.phrase.findMany.mockResolvedValue([])
  mocks.prisma.$transaction.mockImplementation(async (callback) => callback(mocks.tx))
  mocks.tx.pullRequest.deleteMany.mockResolvedValue({ count: 0 })
  mocks.tx.pullRequest.updateMany.mockResolvedValue({ count: 1 })
  mocks.tx.pullRequest.create.mockResolvedValue({ id: 11 })
  mocks.tx.phrase.findFirst.mockResolvedValue(null)
})

describe('PUT /api/batches/[id]/pull-requests', () => {
  it('allows admins to edit another user submitted batch with null remarks', async () => {
    const { PUT } = await import('./route')

    const res = await PUT(
      putRequest({
        items: [
          {
            id: 10,
            action: 'Create',
            word: '测试',
            code: 'ces',
            type: 'Phrase',
            remark: null,
          },
          {
            action: 'Create',
            word: '新词',
            code: 'xinc',
            type: 'Phrase',
            remark: null,
          },
        ],
      }),
      { params: Promise.resolve({ id: 'batch-1' }) }
    )

    expect(res.status).toBe(200)
    expect(mocks.tx.pullRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 10, batchId: 'batch-1' },
      data: expect.objectContaining({ remark: null }),
    }))
    expect(mocks.tx.pullRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        batchId: 'batch-1',
        userId: 2,
        remark: null,
      }),
    }))
  })

  it('rejects pull request ids outside the target batch before starting a transaction', async () => {
    const { PUT } = await import('./route')

    const res = await PUT(
      putRequest({
        items: [{
          id: 99,
          action: 'Create',
          word: '测试',
          code: 'ces',
          type: 'Phrase',
          remark: null,
        }],
      }),
      { params: Promise.resolve({ id: 'batch-1' }) }
    )

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: '修改项不存在或不属于此批次' })
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })
})
