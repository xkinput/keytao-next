import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const mockGetSession = vi.fn()
const mockCheckIsAdmin = vi.fn()
const mockCheckAdminPermission = vi.fn()
const mockVerifyApiKey = vi.fn()
const mockCheckConflict = vi.fn()
const mockCheckBatchConflictsWithWeight = vi.fn()
const mockBuildBatchSubmitWarnings = vi.fn()
const mockCheckRateLimit = vi.fn()
const mockVerifyBotToken = vi.fn()
const mockVerifyToken = vi.fn()
const mockInferPhrases = vi.fn()

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
  signToken: vi.fn(async () => 'token'),
  verifyToken: mockVerifyToken,
  validatePassword: vi.fn(() => ({ valid: true })),
}))

vi.mock('@/lib/adminAuth', () => ({
  checkIsAdmin: mockCheckIsAdmin,
  checkAdminPermission: mockCheckAdminPermission,
}))

vi.mock('@/lib/apiKeyAuth', () => ({
  verifyApiKey: mockVerifyApiKey,
}))

vi.mock('@/lib/rateLimit', () => ({
  checkRateLimit: mockCheckRateLimit,
}))

vi.mock('@/lib/botAuth', () => ({
  verifyBotToken: mockVerifyBotToken,
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

vi.mock('@/lib/services/phraseInference', () => ({
  inferPhrases: mockInferPhrases,
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
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    role: {
      findUnique: vi.fn(),
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
  mockVerifyBotToken.mockResolvedValue(true)
  mockVerifyToken.mockResolvedValue({ id: 1, name: 'rea' })
  mockInferPhrases.mockResolvedValue([])
  mockCheckRateLimit.mockReturnValue({ allowed: true, retryAfterMs: 0 })
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

  it('rate limits logged-in bot chat proxy requests', async () => {
    mockCheckRateLimit.mockReturnValue({ allowed: false, retryAfterMs: 700 })
    const { POST } = await import('./bot/chat/route')

    const res = await POST(jsonRequest('http://localhost/api/bot/chat', {
      message: 'hi',
      session_id: 's1',
    }))

    expect(res.status).toBe(429)
    expect(mockCheckRateLimit).toHaveBeenCalledWith('bot-chat:1')
    expect(fetch).not.toHaveBeenCalled()
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

  it('filters public by-code and by-word lookups to finished phrases', async () => {
    mockPrisma.phrase.findMany.mockResolvedValue([])
    mockPrisma.phrase.count.mockResolvedValue(0)

    const byCode = await import('./phrases/by-code/route')
    const byCodeRes = await byCode.GET(new NextRequest('http://localhost/api/phrases/by-code?code=gv'))

    expect(byCodeRes.status).toBe(200)
    expect(mockPrisma.phrase.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'Finish', code: { startsWith: 'gv' } }),
    }))

    const byWord = await import('./phrases/by-word/route')
    const byWordRes = await byWord.GET(new NextRequest('http://localhost/api/phrases/by-word?word=中国'))

    expect(byWordRes.status).toBe(200)
    expect(mockPrisma.phrase.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'Finish', word: '中国' }),
    }))
  })

  it('rejects overly long public lookup parameters', async () => {
    const byCode = await import('./phrases/by-code/route')
    const byWord = await import('./phrases/by-word/route')

    const longValue = 'x'.repeat(21)
    const byCodeRes = await byCode.GET(new NextRequest(`http://localhost/api/phrases/by-code?code=${longValue}`))
    const byWordRes = await byWord.GET(new NextRequest(`http://localhost/api/phrases/by-word?word=${longValue}`))

    expect(byCodeRes.status).toBe(400)
    expect(byWordRes.status).toBe(400)
  })

  it('rejects invalid phrase context type and clamps count', async () => {
    const { GET } = await import('./phrases/context/route')

    const invalidTypeRes = await GET(new NextRequest('http://localhost/api/phrases/context?code=gv&type=Fake'))
    expect(invalidTypeRes.status).toBe(400)

    const res = await GET(new NextRequest('http://localhost/api/phrases/context?code=gv&count=-10&type=Phrase'))
    expect(res.status).toBe(200)
    expect(mockPrisma.phrase.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 1 }))
  })

  it('limits v1 phrase search length and scan size', async () => {
    const { GET } = await import('./v1/phrases/route')

    const tooLong = await GET(new NextRequest(`http://localhost/api/v1/phrases?search=${'中'.repeat(51)}`))
    expect(tooLong.status).toBe(400)
    expect(mockPrisma.phrase.findMany).not.toHaveBeenCalled()

    mockPrisma.phrase.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    const res = await GET(new NextRequest('http://localhost/api/v1/phrases?search=中国'))
    expect(res.status).toBe(200)
    expect(mockPrisma.phrase.findMany).toHaveBeenCalledTimes(3)
    for (const call of mockPrisma.phrase.findMany.mock.calls) {
      expect(call[0]).toEqual(expect.objectContaining({ take: 500 }))
    }
  })

  it('rejects malformed personal and bot batch lookup payloads', async () => {
    const personalByCode = await import('./v1/phrases/by-code/batch/route')
    const botByWord = await import('./bot/phrases/by-word/batch/route')

    const personalRes = await personalByCode.POST(jsonRequest('http://localhost/api/v1/phrases/by-code/batch', {
      codes: ['a'.repeat(21)],
    }))
    const botRes = await botByWord.POST(jsonRequest('http://localhost/api/bot/phrases/by-word/batch', {
      words: [123],
    }))

    expect(personalRes.status).toBe(400)
    expect(botRes.status).toBe(400)
    expect(mockPrisma.phrase.findMany).not.toHaveBeenCalled()
  })

  it('rate limits login and register attempts before database work', async () => {
    mockCheckRateLimit.mockReturnValue({ allowed: false, retryAfterMs: 900 })
    const login = await import('./auth/login/route')
    const register = await import('./auth/register/route')

    const loginRes = await login.POST(jsonRequest('http://localhost/api/auth/login', {
      name: 'rea',
      password: 'password',
    }))
    const registerRes = await register.POST(jsonRequest('http://localhost/api/auth/register', {
      name: 'rea',
      email: 'rea@example.com',
      password: 'password',
    }))

    expect(loginRes.status).toBe(429)
    expect(registerRes.status).toBe(429)
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled()
    expect(mockPrisma.user.findFirst).not.toHaveBeenCalled()
  })

  it('rate limits refresh and public infer-batch before expensive work', async () => {
    mockCheckRateLimit.mockReturnValue({ allowed: false, retryAfterMs: 900 })
    const refresh = await import('./auth/refresh/route')
    const inferBatch = await import('./phrases/infer-batch/route')

    const refreshRes = await refresh.POST(new NextRequest('http://localhost/api/auth/refresh', {
      method: 'POST',
      headers: { authorization: 'Bearer token' },
    }))
    const inferRes = await inferBatch.POST(jsonRequest('http://localhost/api/phrases/infer-batch', {
      words: ['中国'],
    }))

    expect(refreshRes.status).toBe(429)
    expect(inferRes.status).toBe(429)
    expect(mockVerifyToken).not.toHaveBeenCalled()
    expect(mockInferPhrases).not.toHaveBeenCalled()
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
