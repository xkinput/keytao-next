import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  verifyApiKey: vi.fn(),
  checkBatchConflictsWithWeight: vi.fn(),
  resolvePhraseTargetBinding: vi.fn(),
  batchFindUnique: vi.fn(),
  batchFindFirst: vi.fn(),
  batchCreate: vi.fn(),
  batchUpdateMany: vi.fn(),
  pullRequestFindMany: vi.fn(),
  pullRequestCreate: vi.fn(),
  pullRequestDeleteMany: vi.fn(),
  executeRawUnsafe: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@/lib/apiKeyAuth', () => ({ verifyApiKey: mocks.verifyApiKey }))
vi.mock('@/lib/services/batchConflictService', () => ({
  checkBatchConflictsWithWeight: mocks.checkBatchConflictsWithWeight,
}))
vi.mock('@/lib/services/phraseTargetBinding', () => ({
  resolvePhraseTargetBinding: mocks.resolvePhraseTargetBinding,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    batch: {
      findUnique: mocks.batchFindUnique,
      findFirst: mocks.batchFindFirst,
      create: mocks.batchCreate,
      updateMany: mocks.batchUpdateMany,
    },
    pullRequest: {
      findMany: mocks.pullRequestFindMany,
      create: mocks.pullRequestCreate,
      deleteMany: mocks.pullRequestDeleteMany,
    },
    phrase: {},
    $executeRawUnsafe: mocks.executeRawUnsafe,
    $transaction: mocks.transaction,
  },
}))

function request(body: unknown, method = 'POST') {
  return new NextRequest('http://localhost/api/v1/pull-requests/batch-draft', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function existingBatch(version = 4) {
  return {
    id: 'batch-1', creatorId: 42, status: 'Draft', contentVersion: version,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.verifyApiKey.mockResolvedValue({ success: true, ctx: { userId: 42, apiKeyId: 9 } })
  mocks.checkBatchConflictsWithWeight.mockResolvedValue([{
    id: '0', conflict: { hasConflict: false, suggestions: [] },
  }])
  mocks.resolvePhraseTargetBinding.mockResolvedValue({
    targetPhraseId: null, targetFingerprint: null,
  })
  mocks.batchUpdateMany.mockResolvedValue({ count: 1 })
  mocks.pullRequestCreate.mockResolvedValue({ id: 11 })
  mocks.pullRequestDeleteMany.mockResolvedValue({ count: 1 })
  mocks.pullRequestFindMany.mockResolvedValue([])
  mocks.transaction.mockImplementation(async (callback) => callback({
    batch: {
      findUnique: mocks.batchFindUnique,
      findFirst: mocks.batchFindFirst,
      create: mocks.batchCreate,
      updateMany: mocks.batchUpdateMany,
    },
    pullRequest: {
      findMany: mocks.pullRequestFindMany,
      create: mocks.pullRequestCreate,
      deleteMany: mocks.pullRequestDeleteMany,
    },
    phrase: {},
    $executeRawUnsafe: mocks.executeRawUnsafe,
  }))
})

describe('personal API draft content CAS', () => {
  it('rejects an old POST client that targets an existing batch without a version', async () => {
    mocks.batchFindUnique.mockResolvedValue(existingBatch())
    const { POST } = await import('./route')

    const response = await POST(request({
      batchId: 'batch-1',
      items: [{ action: 'Create', word: '测试', code: 'ceui' }],
    }))

    expect(response.status).toBe(409)
    expect(mocks.batchUpdateMany).not.toHaveBeenCalled()
    expect(mocks.pullRequestCreate).not.toHaveBeenCalled()
  })

  it('rejects a stale POST snapshot before duplicate checks or writes', async () => {
    mocks.batchFindUnique.mockResolvedValue(existingBatch(5))
    mocks.batchUpdateMany.mockResolvedValue({ count: 0 })
    const { POST } = await import('./route')

    const response = await POST(request({
      batchId: 'batch-1', expectedContentVersion: 4,
      items: [{ action: 'Create', word: '测试', code: 'ceui' }],
    }))

    expect(response.status).toBe(409)
    expect(mocks.batchUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'batch-1', creatorId: 42, contentVersion: 4, status: { in: ['Draft'] },
      }),
    }))
    expect(mocks.pullRequestFindMany).not.toHaveBeenCalled()
    expect(mocks.pullRequestCreate).not.toHaveBeenCalled()
  })

  it('claims version zero for a new batch and returns version one', async () => {
    mocks.batchFindFirst.mockResolvedValue(null)
    mocks.batchCreate.mockResolvedValue({ id: 'batch-new', contentVersion: 0 })
    const { POST } = await import('./route')

    const response = await POST(request({
      expectedContentVersion: 0,
      items: [{ action: 'Create', word: '测试', code: 'ceui' }],
    }))

    expect(response.status).toBe(200)
    expect(mocks.executeRawUnsafe.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.batchFindFirst.mock.invocationCallOrder[0],
    )
    expect(mocks.batchUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'batch-new', contentVersion: 0 }),
    }))
    expect(await response.json()).toMatchObject({
      success: true, batchId: 'batch-new', contentVersion: 1,
    })
  })

  it('serializes first writers before selecting or creating the default batch', async () => {
    let currentBatch: ReturnType<typeof existingBatch> | null = null
    mocks.batchFindFirst.mockImplementation(async () => currentBatch)
    mocks.batchCreate.mockImplementation(async () => {
      currentBatch = existingBatch(0)
      return currentBatch
    })
    mocks.batchUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
    const { POST } = await import('./route')
    const body = {
      expectedContentVersion: 0,
      items: [{ action: 'Create', word: '测试', code: 'ceui' }],
    }

    const first = await POST(request(body))
    const second = await POST(request(body))

    expect([first.status, second.status]).toEqual([200, 409])
    expect(mocks.batchCreate).toHaveBeenCalledTimes(1)
    expect(mocks.executeRawUnsafe).toHaveBeenCalledTimes(2)
  })

  it('returns the latest batch id and content version for recovery', async () => {
    mocks.batchFindFirst.mockResolvedValue(existingBatch(6))
    const { GET } = await import('./route')
    const response = await GET(new NextRequest('http://localhost/api/v1/pull-requests/batch-draft'))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      success: true,
      batchId: 'batch-1',
      contentVersion: 6,
    })
  })

  it('allows only one of two concurrent writers with the same old snapshot', async () => {
    mocks.batchFindUnique.mockResolvedValue(existingBatch(4))
    mocks.batchUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
    const { POST } = await import('./route')
    const body = {
      batchId: 'batch-1', expectedContentVersion: 4,
      items: [{ action: 'Create', word: '测试', code: 'ceui' }],
    }

    const responses = await Promise.all([POST(request(body)), POST(request(body))])

    expect(responses.map(response => response.status).sort()).toEqual([200, 409])
    expect(mocks.pullRequestCreate).toHaveBeenCalledTimes(1)
  })

  it('rejects missing and stale DELETE snapshots without resolving target rows', async () => {
    const { DELETE } = await import('./route')

    const missing = await DELETE(request({ ids: [11] }, 'DELETE'))
    expect(missing.status).toBe(409)
    expect(mocks.pullRequestFindMany).not.toHaveBeenCalled()

    mocks.batchFindUnique.mockResolvedValue(existingBatch(5))
    mocks.batchUpdateMany.mockResolvedValue({ count: 0 })
    const stale = await DELETE(request({
      ids: [11], batchId: 'batch-1', expectedContentVersion: 4,
    }, 'DELETE'))

    expect(stale.status).toBe(409)
    expect(mocks.pullRequestFindMany).not.toHaveBeenCalled()
    expect(mocks.pullRequestDeleteMany).not.toHaveBeenCalled()
  })

  it('deletes only after an exact claim and returns the incremented version', async () => {
    mocks.batchFindUnique.mockResolvedValue(existingBatch(4))
    mocks.pullRequestFindMany
      .mockResolvedValueOnce([{
        id: 11, action: 'Create', word: '测试', code: 'ceui', userId: 42,
        batchId: 'batch-1', type: 'Phrase', weight: null, status: 'Pending',
      }])
      .mockResolvedValueOnce([])
    const { DELETE } = await import('./route')

    const response = await DELETE(request({
      ids: [11], batchId: 'batch-1', expectedContentVersion: 4,
    }, 'DELETE'))

    expect(response.status).toBe(200)
    expect(mocks.pullRequestDeleteMany).toHaveBeenCalledWith({
      where: { id: { in: [11] }, userId: 42, batchId: 'batch-1' },
    })
    expect(await response.json()).toMatchObject({
      success: true, batchId: 'batch-1', contentVersion: 5, successCount: 1,
    })
  })
})
