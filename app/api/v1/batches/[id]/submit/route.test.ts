import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  apiKeyFindUnique: vi.fn(),
  apiKeyUpdate: vi.fn(),
  batchFindUnique: vi.fn(),
  batchUpdateMany: vi.fn(),
  phraseFindMany: vi.fn(),
  executeRaw: vi.fn(),
  transaction: vi.fn(),
  checkBatchConflictsWithWeight: vi.fn(),
  buildBatchSubmitWarnings: vi.fn(),
  buildSkippedCandidateSlotWarnings: vi.fn(),
  collectSkippedCandidateSlotDependencies: vi.fn(),
  buildPriorityOrderWarnings: vi.fn(),
}))

vi.mock('@/lib/rateLimit', () => ({ checkRateLimit: mocks.checkRateLimit }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    apiKey: { findUnique: mocks.apiKeyFindUnique, update: mocks.apiKeyUpdate },
    batch: { findUnique: mocks.batchFindUnique, updateMany: mocks.batchUpdateMany },
    phrase: { findMany: mocks.phraseFindMany },
    $transaction: mocks.transaction,
  },
}))
vi.mock('@/lib/services/batchConflictService', () => ({
  checkBatchConflictsWithWeight: mocks.checkBatchConflictsWithWeight,
}))
vi.mock('@/lib/services/batchSubmitWarnings', () => ({
  buildBatchSubmitWarnings: mocks.buildBatchSubmitWarnings,
}))
vi.mock('@/lib/services/batchSkippedCodeWarnings', () => ({
  buildSkippedCandidateSlotWarnings: mocks.buildSkippedCandidateSlotWarnings,
  collectSkippedCandidateSlotDependencies: mocks.collectSkippedCandidateSlotDependencies,
}))
vi.mock('@/lib/services/batchPriorityOrderWarnings', () => ({
  buildPriorityOrderWarnings: mocks.buildPriorityOrderWarnings,
}))

function createRequest(body?: unknown, apiKey: string | null = 'kt_valid_test_key') {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey !== null) {
    headers['X-API-Key'] = apiKey
  }
  return new NextRequest('http://localhost/api/v1/batches/batch-1/submit', {
    method: 'POST',
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

function draftBatch(overrides: Record<string, unknown> = {}) {
  return {
    id: 'batch-1',
    creatorId: 42,
    status: 'Draft',
    contentVersion: 3,
    pullRequests: [{
      id: 1,
      action: 'Create',
      word: '测试',
      oldWord: null,
      code: 'ces',
      type: 'Phrase',
      weight: null,
    }],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.checkRateLimit.mockReturnValue({ allowed: true, retryAfterMs: 0 })
  mocks.apiKeyFindUnique.mockResolvedValue({
    id: 9,
    userId: 42,
    enabled: true,
    user: { status: 'ENABLE' },
  })
  mocks.apiKeyUpdate.mockResolvedValue({})
  mocks.batchFindUnique.mockResolvedValue(draftBatch())
  mocks.batchUpdateMany.mockResolvedValue({ count: 1 })
  mocks.phraseFindMany.mockResolvedValue([])
  mocks.executeRaw.mockResolvedValue(0)
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
    batch: { updateMany: mocks.batchUpdateMany },
    phrase: { findMany: mocks.phraseFindMany },
    $executeRawUnsafe: mocks.executeRaw,
  }))
  mocks.checkBatchConflictsWithWeight.mockResolvedValue([{ conflict: { hasConflict: false } }])
  mocks.buildBatchSubmitWarnings.mockReturnValue([])
  mocks.buildSkippedCandidateSlotWarnings.mockResolvedValue([])
  mocks.collectSkippedCandidateSlotDependencies.mockResolvedValue([])
  mocks.buildPriorityOrderWarnings.mockResolvedValue([])
})

describe('POST /api/v1/batches/[id]/submit', () => {
  it('rejects requests without an API key', async () => {
    const { POST } = await import('./route')
    const res = await POST(createRequest({}, null), { params: Promise.resolve({ id: 'batch-1' }) })

    expect(res.status).toBe(401)
    expect(mocks.batchFindUnique).not.toHaveBeenCalled()
  })

  it('rejects disabled API keys and banned accounts', async () => {
    const { POST } = await import('./route')

    mocks.apiKeyFindUnique.mockResolvedValueOnce({
      id: 9, userId: 42, enabled: false, user: { status: 'ENABLE' },
    })
    const disabledKeyRes = await POST(createRequest({}), { params: Promise.resolve({ id: 'batch-1' }) })
    expect(disabledKeyRes.status).toBe(403)

    mocks.apiKeyFindUnique.mockResolvedValueOnce({
      id: 9, userId: 42, enabled: true, user: { status: 'DISABLE' },
    })
    const bannedUserRes = await POST(createRequest({}), { params: Promise.resolve({ id: 'batch-1' }) })
    expect(bannedUserRes.status).toBe(403)
    expect(mocks.batchFindUnique).not.toHaveBeenCalled()
  })

  it('enforces API key rate limit', async () => {
    mocks.checkRateLimit.mockReturnValue({ allowed: false, retryAfterMs: 600 })
    const { POST } = await import('./route')
    const res = await POST(createRequest({}), { params: Promise.resolve({ id: 'batch-1' }) })

    expect(res.status).toBe(429)
    expect(mocks.batchFindUnique).not.toHaveBeenCalled()
  })

  it('rejects submitting another user batch', async () => {
    mocks.batchFindUnique.mockResolvedValue(draftBatch({ creatorId: 99 }))
    const { POST } = await import('./route')
    const res = await POST(createRequest({ expectedContentVersion: 3 }), {
      params: Promise.resolve({ id: 'batch-1' }),
    })

    expect(res.status).toBe(403)
    expect(mocks.batchUpdateMany).not.toHaveBeenCalled()
  })

  it('submits a clean draft batch via X-API-Key and advances contentVersion', async () => {
    const { POST } = await import('./route')
    const res = await POST(createRequest({ expectedContentVersion: 3 }), {
      params: Promise.resolve({ id: 'batch-1' }),
    })

    expect(res.status).toBe(200)
    expect(mocks.batchUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'batch-1',
        creatorId: 42,
        status: { in: ['Draft', 'Rejected'] },
        contentVersion: 3,
        itemReviewStarted: false,
      },
      data: {
        status: 'Submitted',
        reviewNote: null,
        contentVersion: { increment: 1 },
      },
    })
    expect(await res.json()).toEqual({
      batch: { id: 'batch-1', status: 'Submitted', contentVersion: 4 },
    })
  })

  it('submits a clean draft even when body is empty', async () => {
    const { POST } = await import('./route')
    const res = await POST(createRequest(undefined), {
      params: Promise.resolve({ id: 'batch-1' }),
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      batch: { id: 'batch-1', status: 'Submitted', contentVersion: 4 },
    })
  })

  it('rejects stale expectedContentVersion with 409', async () => {
    const { POST } = await import('./route')
    const res = await POST(createRequest({ expectedContentVersion: 2 }), {
      params: Promise.resolve({ id: 'batch-1' }),
    })

    expect(res.status).toBe(409)
    expect(mocks.batchUpdateMany).not.toHaveBeenCalled()
  })

  it('supports two-step warning confirmation with snapshot digest', async () => {
    mocks.buildBatchSubmitWarnings.mockReturnValue([{ type: 'duplicate_code', message: '重码警告' }])
    const { POST } = await import('./route')

    const preview = await POST(createRequest({ expectedContentVersion: 3 }), {
      params: Promise.resolve({ id: 'batch-1' }),
    })
    expect(preview.status).toBe(400)
    const previewBody = await preview.json()
    expect(previewBody).toMatchObject({
      requiresConfirmation: true,
      batchId: 'batch-1',
      contentVersion: 3,
      warningDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(mocks.batchUpdateMany).not.toHaveBeenCalled()

    const confirmed = await POST(createRequest({
      confirmed: true,
      expectedContentVersion: previewBody.contentVersion,
      expectedWarningDigest: previewBody.warningDigest,
    }), {
      params: Promise.resolve({ id: 'batch-1' }),
    })

    expect(confirmed.status).toBe(200)
    expect(mocks.executeRaw).toHaveBeenCalledWith('LOCK TABLE "phrases" IN SHARE ROW EXCLUSIVE MODE')
    expect(await confirmed.json()).toEqual({
      batch: { id: 'batch-1', status: 'Submitted', contentVersion: 4 },
    })
  })

  it('rejects unresolved conflicts and empty batches', async () => {
    const { POST } = await import('./route')

    mocks.batchFindUnique.mockResolvedValueOnce(draftBatch({ pullRequests: [] }))
    const emptyRes = await POST(createRequest({}), { params: Promise.resolve({ id: 'batch-1' }) })
    expect(emptyRes.status).toBe(400)

    mocks.checkBatchConflictsWithWeight.mockResolvedValueOnce([{
      conflict: { hasConflict: true, impact: '冲突' },
    }])
    const conflictRes = await POST(createRequest({}), { params: Promise.resolve({ id: 'batch-1' }) })
    expect(conflictRes.status).toBe(400)
    expect(mocks.batchUpdateMany).not.toHaveBeenCalled()
  })
})
