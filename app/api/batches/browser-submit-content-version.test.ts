import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mockGetSession = vi.fn()
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
vi.mock('@/lib/prisma', () => ({
  prisma: {
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

function request(body?: unknown) {
  return new NextRequest('http://localhost/api/batches/batch-1/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue({ id: 42 })
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
})
