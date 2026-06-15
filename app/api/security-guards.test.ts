import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const mockGetSession = vi.fn()
const mockCheckIsAdmin = vi.fn()
const mockCheckAdminPermission = vi.fn()
const mockVerifyApiKey = vi.fn()
const mockCheckConflict = vi.fn()
const mockCheckBatchConflictsWithWeight = vi.fn()
const mockBuildBatchSubmitWarnings = vi.fn()

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/adminAuth', () => ({
  checkIsAdmin: mockCheckIsAdmin,
  checkAdminPermission: mockCheckAdminPermission,
}))

vi.mock('@/lib/apiKeyAuth', () => ({
  verifyApiKey: mockVerifyApiKey,
}))

vi.mock('@/lib/services/conflictDetector', () => ({
  conflictDetector: {
    checkConflict: mockCheckConflict,
  },
}))

vi.mock('@/lib/services/batchConflictService', () => ({
  checkBatchConflictsWithWeight: mockCheckBatchConflictsWithWeight,
  calculateWeightForType: vi.fn(() => 100),
}))

vi.mock('@/lib/services/batchSubmitWarnings', () => ({
  buildBatchSubmitWarnings: mockBuildBatchSubmitWarnings,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    batch: {
      findUnique: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
    },
    pullRequest: {
      create: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    phrase: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
    codeConflict: {
      create: vi.fn(),
    },
    syncTask: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    apiKey: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}))

const { prisma } = await import('@/lib/prisma')
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockPrisma = prisma as any

function jsonRequest(url: string, body: unknown) {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function draftItem(overrides: Record<string, unknown> = {}) {
  return { action: 'Create', word: '测试', code: 'ces', type: 'Phrase', ...overrides }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue({ id: 1, name: 'rea' })
  mockCheckIsAdmin.mockResolvedValue(false)
  mockCheckAdminPermission.mockResolvedValue({ authorized: true, response: undefined })
  mockVerifyApiKey.mockResolvedValue({ success: true, ctx: { userId: 1, apiKeyId: 1 } })
  mockCheckConflict.mockResolvedValue({ hasConflict: false })
  mockCheckBatchConflictsWithWeight.mockResolvedValue([])
  mockBuildBatchSubmitWarnings.mockReturnValue([])
  mockPrisma.batch.create.mockResolvedValue({ id: 'batch-new' })
  mockPrisma.pullRequest.create.mockResolvedValue({ id: 1 })
  mockPrisma.pullRequest.findMany.mockResolvedValue([])
  mockPrisma.phrase.findMany.mockResolvedValue([])
  mockPrisma.phrase.count.mockResolvedValue(0)
  mockPrisma.phrase.groupBy.mockResolvedValue([])
  mockPrisma.syncTask.findMany.mockResolvedValue([])
  mockPrisma.syncTask.count.mockResolvedValue(0)
  vi.stubGlobal('fetch', vi.fn(async () => ({
    status: 200,
    json: async () => ({ reply: 'ok' }),
  })))
})

describe('API abuse guards', () => {
  it('rejects creating a single PR in another user batch', async () => {
    mockPrisma.batch.findUnique.mockResolvedValue({ id: 'batch-1', creatorId: 2, status: 'Draft' })
    const { POST } = await import('./pull-requests/route')

    const res = await POST(jsonRequest('http://localhost/api/pull-requests', {
      action: 'Create',
      word: '测试',
      code: 'ces',
      type: 'Phrase',
      batchId: 'batch-1',
    }))

    expect(res.status).toBe(403)
    expect(mockPrisma.pullRequest.create).not.toHaveBeenCalled()
  })

  it('rejects creating a single PR in a submitted batch', async () => {
    mockPrisma.batch.findUnique.mockResolvedValue({ id: 'batch-1', creatorId: 1, status: 'Submitted' })
    const { POST } = await import('./pull-requests/route')

    const res = await POST(jsonRequest('http://localhost/api/pull-requests', {
      action: 'Create',
      word: '测试',
      code: 'ces',
      type: 'Phrase',
      batchId: 'batch-1',
    }))

    expect(res.status).toBe(400)
    expect(mockPrisma.pullRequest.create).not.toHaveBeenCalled()
  })

  it('requires login for bot chat proxy', async () => {
    mockGetSession.mockResolvedValue(null)
    const { POST, DELETE } = await import('./bot/chat/route')

    const postRes = await POST(jsonRequest('http://localhost/api/bot/chat', { message: 'hi', session_id: 's1' }))
    const deleteRes = await DELETE(jsonRequest('http://localhost/api/bot/chat', { session_id: 's1' }))

    expect(postRes.status).toBe(401)
    expect(deleteRes.status).toBe(401)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('overwrites client supplied user_id before proxying bot chat', async () => {
    const { POST } = await import('./bot/chat/route')

    const res = await POST(jsonRequest('http://localhost/api/bot/chat', {
      message: 'hi',
      session_id: 's1',
      user_id: 'evil',
    }))

    expect(res.status).toBe(200)
    expect(fetch).toHaveBeenCalledOnce()
    const proxiedBody = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))
    expect(proxiedBody).toEqual({ message: 'hi', session_id: 's1', user_id: '1' })
  })

  it('protects draft batch previews from non-owners', async () => {
    mockPrisma.batch.findUnique.mockResolvedValue({ id: 'batch-1', creatorId: 2, status: 'Draft', pullRequests: [] })
    const { GET } = await import('./batches/[id]/preview/route')

    const res = await GET(new NextRequest('http://localhost/api/batches/batch-1/preview'), { params: Promise.resolve({ id: 'batch-1' }) })

    expect(res.status).toBe(403)
  })

  it('requires admin for sync task history', async () => {
    mockCheckAdminPermission.mockResolvedValue({
      authorized: false,
      response: NextResponse.json({ error: '权限不足' }, { status: 403 }),
    })
    const { GET } = await import('./admin/sync-to-github/tasks/route')

    const res = await GET(new NextRequest('http://localhost/api/admin/sync-to-github/tasks'))

    expect(res.status).toBe(403)
    expect(mockPrisma.syncTask.findMany).not.toHaveBeenCalled()
  })

  it('clamps public phrase pagination and only returns finished phrases', async () => {
    const { GET } = await import('./phrases/route')

    const res = await GET(new NextRequest('http://localhost/api/phrases?page=-2&pageSize=999'))

    expect(res.status).toBe(200)
    expect(mockPrisma.phrase.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'Finish' },
      skip: 0,
      take: 100,
    }))
  })

  it('rejects oversized conflict-check batches', async () => {
    const { POST } = await import('./pull-requests/check-conflicts-batch/route')
    const items = Array.from({ length: 101 }, () => draftItem())

    const res = await POST(jsonRequest('http://localhost/api/pull-requests/check-conflicts-batch', { items }))

    expect(res.status).toBe(400)
    expect(mockCheckBatchConflictsWithWeight).not.toHaveBeenCalled()
  })

  it('rejects oversized personal API draft batches', async () => {
    const { POST } = await import('./v1/pull-requests/batch-draft/route')
    const items = Array.from({ length: 101 }, () => draftItem())

    const res = await POST(jsonRequest('http://localhost/api/v1/pull-requests/batch-draft', { items }))

    expect(res.status).toBe(400)
    expect(mockPrisma.batch.findFirst).not.toHaveBeenCalled()
  })

  it('rejects invalid personal API draft delete ids', async () => {
    const { DELETE } = await import('./v1/pull-requests/batch-draft/route')

    const res = await DELETE(new NextRequest('http://localhost/api/v1/pull-requests/batch-draft', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [0] }),
    }))

    expect(res.status).toBe(400)
    expect(mockPrisma.pullRequest.findMany).not.toHaveBeenCalled()
  })
})
