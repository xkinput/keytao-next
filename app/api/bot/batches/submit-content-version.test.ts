import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mockRequireVerifiedBotUser = vi.fn()
const mockFindUnique = vi.fn()
const mockUpdateMany = vi.fn()
const mockCheckBatchConflicts = vi.fn()
const mockBuildWarnings = vi.fn()
const mockPhraseFindMany = vi.fn()
const mockExecuteRaw = vi.fn()
const mockTransaction = vi.fn(async (callback: (tx: unknown) => unknown) => callback({
  batch: { updateMany: mockUpdateMany },
  pullRequest: { findMany: vi.fn(async () => draftBatch().pullRequests) },
  phrase: { findMany: mockPhraseFindMany },
  $executeRawUnsafe: mockExecuteRaw,
}))

vi.mock('@/lib/botUserAuth', () => ({ requireVerifiedBotUser: mockRequireVerifiedBotUser }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    batch: { findUnique: mockFindUnique, updateMany: mockUpdateMany },
    phrase: { findMany: mockPhraseFindMany },
    $transaction: mockTransaction,
  },
}))
vi.mock('@/lib/services/batchConflictService', () => ({
  checkBatchConflictsWithWeight: mockCheckBatchConflicts,
}))
vi.mock('@/lib/services/batchSubmitWarnings', () => ({ buildBatchSubmitWarnings: mockBuildWarnings }))
vi.mock('@/lib/services/batchSkippedCodeWarnings', () => ({
  buildSkippedCandidateSlotWarnings: vi.fn(async () => []),
  collectSkippedCandidateSlotDependencies: vi.fn(async () => []),
}))
vi.mock('@/lib/services/batchPriorityOrderWarnings', () => ({ buildPriorityOrderWarnings: vi.fn(async () => []) }))

function request(body: unknown) {
  return new NextRequest('http://localhost/api/bot/batches/batch-1/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function draftBatch() {
  return {
    id: 'batch-1',
    creatorId: 42,
    status: 'Draft',
    contentVersion: 7,
    pullRequests: [{
      id: 1,
      action: 'Create',
      word: '测试',
      oldWord: null,
      code: 'ces',
      type: 'Phrase',
      weight: null,
    }],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireVerifiedBotUser.mockResolvedValue({ authorized: true, user: { id: 42 } })
  mockFindUnique.mockResolvedValue(draftBatch())
  mockCheckBatchConflicts.mockResolvedValue([{ conflict: { hasConflict: false } }])
  mockBuildWarnings.mockReturnValue([])
  mockUpdateMany.mockResolvedValue({ count: 1 })
  mockPhraseFindMany.mockResolvedValue([])
  mockExecuteRaw.mockResolvedValue(0)
})

describe('bot batch submit content snapshot', () => {
  it('requires a non-negative integer expectedContentVersion on every request', async () => {
    const { POST } = await import('./[id]/submit/route')
    const res = await POST(request({ platform: 'qq', platformId: 'u-1' }), {
      params: Promise.resolve({ id: 'batch-1' }),
    })

    expect(res.status).toBe(400)
    expect(mockFindUnique).not.toHaveBeenCalled()
  })

  it('returns the exact batch id and content version with server warnings', async () => {
    mockBuildWarnings.mockReturnValue([{ type: 'duplicate_code', message: 'warning' }])
    const { POST } = await import('./[id]/submit/route')
    const res = await POST(request({
      platform: 'qq',
      platformId: 'u-1',
      expectedContentVersion: 7,
    }), { params: Promise.resolve({ id: 'batch-1' }) })

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({
      requiresConfirmation: true,
      batchId: 'batch-1',
      contentVersion: 7,
    })
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })

  it('uses owner, status, and version in the final CAS and rejects stale snapshots', async () => {
    const { POST } = await import('./[id]/submit/route')
    const preview = await POST(request({
      platform: 'qq', platformId: 'u-1', expectedContentVersion: 7, previewOnly: true,
    }), { params: Promise.resolve({ id: 'batch-1' }) })
    const previewData = await preview.json()
    const warningDigest = previewData.warningDigest
    const snapshotDigest = previewData.snapshotDigest
    mockUpdateMany.mockResolvedValue({ count: 0 })
    const res = await POST(request({
      platform: 'qq',
      platformId: 'u-1',
      expectedContentVersion: 7,
      expectedWarningDigest: warningDigest,
      expectedSnapshotDigest: snapshotDigest,
      confirmed: true,
    }), { params: Promise.resolve({ id: 'batch-1' }) })

    expect(res.status).toBe(409)
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'batch-1',
        creatorId: 42,
        status: { in: ['Draft', 'Rejected'] },
        contentVersion: 7,
      },
      data: { status: 'Submitted', reviewNote: null, contentVersion: { increment: 1 } },
    })
  })

  it('returns the advanced version after the status transition', async () => {
    const { POST } = await import('./[id]/submit/route')
    const preview = await POST(request({
      platform: 'qq', platformId: 'u-1', expectedContentVersion: 7, previewOnly: true,
    }), { params: Promise.resolve({ id: 'batch-1' }) })
    const previewData = await preview.json()

    const res = await POST(request({
      platform: 'qq',
      platformId: 'u-1',
      expectedContentVersion: 7,
      expectedWarningDigest: previewData.warningDigest,
      expectedSnapshotDigest: previewData.snapshotDigest,
      confirmed: true,
    }), { params: Promise.resolve({ id: 'batch-1' }) })

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      success: true,
      batch: { id: 'batch-1', status: 'Submitted', contentVersion: 8 },
    })
  })
})
