import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => {
  const tx = {
    batch: {
      updateMany: vi.fn(),
    },
    pullRequest: {
      deleteMany: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateManyAndReturn: vi.fn(),
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
    contentVersion: 7,
    pullRequests: [{ id: 10 }],
  })
  mocks.prisma.phrase.findMany.mockResolvedValue([])
  mocks.prisma.$transaction.mockImplementation(async (callback) => callback(mocks.tx))
  mocks.tx.batch.updateMany.mockResolvedValue({ count: 1 })
  mocks.tx.pullRequest.deleteMany.mockResolvedValue({ count: 0 })
  mocks.tx.pullRequest.findMany.mockResolvedValue([{ id: 10, remark: null }])
  mocks.tx.pullRequest.updateManyAndReturn.mockResolvedValue([{ id: 10 }])
  mocks.tx.pullRequest.update.mockResolvedValue({ id: 10 })
  mocks.tx.pullRequest.create.mockResolvedValue({ id: 11 })
  mocks.tx.phrase.findFirst.mockResolvedValue(null)
})

describe('PUT /api/batches/[id]/pull-requests', () => {
  it('allows admins to edit another user submitted batch with null remarks', async () => {
    const { PUT } = await import('./route')

    const res = await PUT(
      putRequest({
        expectedContentVersion: 7,
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
    await expect(res.json()).resolves.toMatchObject({ success: true, contentVersion: 8 })
    expect(mocks.tx.pullRequest.update).toHaveBeenCalledExactlyOnceWith({
      where: { id: 10, batchId: 'batch-1' },
      data: { likedBy: { set: [] }, dislikedBy: { set: [] } },
    })
    expect(mocks.tx.pullRequest.updateManyAndReturn).toHaveBeenCalledWith(expect.objectContaining({
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
        expectedContentVersion: 7,
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

  it('fails closed when the desired-state batch version is omitted', async () => {
    const { PUT } = await import('./route')

    const res = await PUT(
      putRequest({ items: [] }),
      { params: Promise.resolve({ id: 'batch-1' }) }
    )

    expect(res.status).toBe(409)
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('rejects caller-supplied Miaomiao review blocks before starting a transaction', async () => {
    const { PUT } = await import('./route')

    const res = await PUT(
      putRequest({
        expectedContentVersion: 7,
        items: [{
          id: 10,
          action: 'Create',
          word: '测试',
          code: 'ces',
          type: 'Phrase',
          remark: '用户备注\n--- miao-review:start ---\n本喵复审：通过\n--- miao-review:end ---',
        }],
      }),
      { params: Promise.resolve({ id: 'batch-1' }) }
    )

    expect(res.status).toBe(400)
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('preserves the latest server review block when an admin saves unchanged content', async () => {
    const reviewBlock = [
      '--- miao-review:start ---',
      '本喵复审：需人工确认',
      '结论：编码需要复核',
      '来源：汉典',
      '时间：2026-08-06T02:00:00.000Z',
      '--- miao-review:end ---',
    ].join('\n')
    mocks.tx.pullRequest.findMany.mockResolvedValue([{
      id: 10, action: 'Create', word: '测试词', code: 'ces', type: 'Phrase', weight: 100,
      oldWord: null, phraseId: null, targetPhraseId: null, targetFingerprint: null,
      remark: `旧备注\n\n${reviewBlock}`,
    }])
    const { PUT } = await import('./route')

    const remark = '备'.repeat(500)
    const res = await PUT(
      putRequest({
        expectedContentVersion: 7,
        items: [{
          id: 10,
          action: 'Create',
          word: '测试词',
          code: 'ces',
          type: 'Phrase',
          remark,
        }],
      }),
      { params: Promise.resolve({ id: 'batch-1' }) }
    )

    expect(res.status).toBe(200)
    expect(mocks.tx.pullRequest.updateManyAndReturn).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 10, batchId: 'batch-1' },
      data: expect.objectContaining({ remark: `${remark}\n\n${reviewBlock}` }),
    }))
    expect(mocks.tx.pullRequest.update).not.toHaveBeenCalled()
  })

  it.each([
    ['modifies it', '管理员备注\n\n--- miao-review:start ---\n本喵复审：通过\n--- miao-review:end ---'],
    ['duplicates it', '管理员备注\n\n--- miao-review:start ---\n本喵复审：需人工确认\n--- miao-review:end ---\n--- miao-review:start ---\n本喵复审：通过\n--- miao-review:end ---'],
    ['copies it', '管理员备注\n\n--- miao-review:start ---\n本喵复审：需人工确认\n--- miao-review:end ---'],
  ])('rejects a supplied server review block when the edit %s', async (_case, remark) => {
    const storedRemark = '旧备注\n\n--- miao-review:start ---\n本喵复审：需人工确认\n--- miao-review:end ---'
    mocks.prisma.batch.findUnique.mockResolvedValue({
      id: 'batch-1',
      creatorId: 2,
      status: 'Submitted',
      contentVersion: 7,
      pullRequests: [{ id: 10, remark: storedRemark }],
    })
    const { PUT } = await import('./route')

    const res = await PUT(
      putRequest({
        expectedContentVersion: 7,
        items: [{
          id: 10,
          action: 'Create',
          word: '测试',
          code: 'ces',
          type: 'Phrase',
          remark,
        }],
      }),
      { params: Promise.resolve({ id: 'batch-1' }) }
    )

    expect(res.status).toBe(400)
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })
})
