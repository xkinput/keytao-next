import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mockGetSession = vi.fn()
const mockApiKeyFindUnique = vi.fn()
const mockApiKeyUpdate = vi.fn()
const mockCheckRateLimit = vi.fn()
const mockFindUnique = vi.fn()
const mockUpdateMany = vi.fn()
const mockCheckBatchConflicts = vi.fn()
const mockBuildWarnings = vi.fn()
const mockPhraseFindMany = vi.fn()
const mockExecuteRaw = vi.fn()
const mockTransaction = vi.fn(async (callback: (tx: unknown) => unknown) => callback({
  batch: { updateMany: mockUpdateMany },
  phrase: { findMany: mockPhraseFindMany },
  $executeRawUnsafe: mockExecuteRaw,
}))

vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))
vi.mock('@/lib/rateLimit', () => ({ checkRateLimit: mockCheckRateLimit }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    apiKey: { findUnique: mockApiKeyFindUnique, update: mockApiKeyUpdate },
    batch: { findUnique: mockFindUnique, updateMany: mockUpdateMany },
    phrase: { findMany: mockPhraseFindMany },
    $transaction: mockTransaction,
  },
}))
vi.mock('@/lib/services/batchConflictService', () => ({ checkBatchConflictsWithWeight: mockCheckBatchConflicts }))
vi.mock('@/lib/services/batchSubmitWarnings', () => ({ buildBatchSubmitWarnings: mockBuildWarnings }))
vi.mock('@/lib/services/batchSkippedCodeWarnings', () => ({
  buildSkippedCandidateSlotWarnings: vi.fn(async () => []),
  collectSkippedCandidateSlotDependencies: vi.fn(async () => []),
}))
vi.mock('@/lib/services/batchPriorityOrderWarnings', () => ({ buildPriorityOrderWarnings: vi.fn(async () => []) }))

function request(body?: unknown, extraHeaders: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/batches/batch-1/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue({ id: 42 })
  mockCheckRateLimit.mockReturnValue({ allowed: true, retryAfterMs: 0 })
  mockApiKeyFindUnique.mockResolvedValue({
    id: 9,
    userId: 42,
    enabled: true,
    user: { status: 'ENABLE' },
  })
  mockApiKeyUpdate.mockResolvedValue({})
  mockFindUnique.mockResolvedValue({
    id: 'batch-1', creatorId: 42, status: 'Draft', contentVersion: 3,
    pullRequests: [{ id: 1, action: 'Create', word: '测试', oldWord: null, code: 'ces', type: 'Phrase', weight: null }],
  })
  mockCheckBatchConflicts.mockResolvedValue([{ conflict: { hasConflict: false } }])
  mockBuildWarnings.mockReturnValue([])
  mockUpdateMany.mockResolvedValue({ count: 1 })
  mockPhraseFindMany.mockResolvedValue([])
  mockExecuteRaw.mockResolvedValue(0)
})

describe('browser batch submit content snapshot', () => {
  it('advances the version when a clean draft becomes submitted', async () => {
    const { POST } = await import('./[id]/submit/route')
    const res = await POST(request(), { params: Promise.resolve({ id: 'batch-1' }) })

    expect(res.status).toBe(200)
    expect(mockUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        status: 'Submitted',
        reviewNote: null,
        contentVersion: { increment: 1 },
      },
    }))
    expect(await res.json()).toMatchObject({
      batch: { id: 'batch-1', status: 'Submitted', contentVersion: 4 },
    })
  })

  it('returns the server snapshot version with warnings', async () => {
    mockBuildWarnings.mockReturnValue([{ type: 'duplicate_code', message: 'warning' }])
    const { POST } = await import('./[id]/submit/route')
    const res = await POST(request(), { params: Promise.resolve({ id: 'batch-1' }) })

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({
      requiresConfirmation: true,
      batchId: 'batch-1',
      contentVersion: 3,
    })
  })

  it('requires confirmation to carry the warning snapshot into the final CAS', async () => {
    const { POST } = await import('./[id]/submit/route')
    const missing = await POST(request({ confirmed: true }), { params: Promise.resolve({ id: 'batch-1' }) })
    expect(missing.status).toBe(400)
    expect(mockUpdateMany).not.toHaveBeenCalled()

    mockBuildWarnings.mockReturnValue([{ type: 'duplicate_code', message: 'warning' }])
    const preview = await POST(request(), { params: Promise.resolve({ id: 'batch-1' }) })
    const warningDigest = (await preview.json()).warningDigest
    mockUpdateMany.mockResolvedValue({ count: 0 })
    const stale = await POST(request({
      confirmed: true,
      expectedContentVersion: 3,
      expectedWarningDigest: warningDigest,
    }), {
      params: Promise.resolve({ id: 'batch-1' }),
    })
    expect(stale.status).toBe(409)
    expect(mockUpdateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'batch-1', creatorId: 42, contentVersion: 3 }),
    }))
  })

  it('accepts X-API-Key when no Bearer session is present', async () => {
    mockGetSession.mockResolvedValue(null)
    const { POST } = await import('./[id]/submit/route')

    const res = await POST(request({ expectedContentVersion: 3 }, { 'X-API-Key': 'kt_valid_key' }), {
      params: Promise.resolve({ id: 'batch-1' }),
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      batch: { id: 'batch-1', status: 'Submitted', contentVersion: 4 },
    })
  })

  it('rejects unauthenticated requests and invalid API keys', async () => {
    mockGetSession.mockResolvedValue(null)
    const { POST } = await import('./[id]/submit/route')

    const unauth = await POST(request(), { params: Promise.resolve({ id: 'batch-1' }) })
    expect(unauth.status).toBe(401)
    expect(await unauth.json()).toEqual({ error: '未登录' })

    mockApiKeyFindUnique.mockResolvedValueOnce(null)
    const invalidKey = await POST(request({}, { 'X-API-Key': 'kt_invalid' }), {
      params: Promise.resolve({ id: 'batch-1' }),
    })
    expect(invalidKey.status).toBe(401)
    expect(await invalidKey.json()).toEqual({ error: 'API Key 无效' })

    mockApiKeyFindUnique.mockResolvedValueOnce({
      id: 9,
      userId: 99,
      enabled: true,
      user: { status: 'ENABLE' },
    })
    const wrongOwner = await POST(request({}, { 'X-API-Key': 'kt_other_user' }), {
      params: Promise.resolve({ id: 'batch-1' }),
    })
    expect(wrongOwner.status).toBe(403)
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })
})
