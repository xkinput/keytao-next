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
const mockCreateGithubSyncService = vi.fn()

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

vi.mock('@/lib/services/githubSync', () => ({
  createGithubSyncService: mockCreateGithubSyncService,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    batch: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    pullRequest: {
      findUnique: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    issue: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    comment: {
      create: vi.fn(),
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
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    apiKey: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(async (operations: unknown[]) => Promise.all(operations)),
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
  mockCreateGithubSyncService.mockReturnValue({})
  mockPrisma.batch.create.mockResolvedValue({ id: 'batch-new' })
  mockPrisma.batch.update.mockResolvedValue({ id: 'batch-1' })
  mockPrisma.batch.updateMany.mockResolvedValue({ count: 0 })
  mockPrisma.batch.findMany.mockResolvedValue([])
  mockPrisma.pullRequest.create.mockResolvedValue({ id: 1 })
  mockPrisma.pullRequest.findMany.mockResolvedValue([])
  mockPrisma.pullRequest.count.mockResolvedValue(0)
  mockPrisma.issue.create.mockResolvedValue({ id: 1 })
  mockPrisma.issue.findMany.mockResolvedValue([])
  mockPrisma.issue.count.mockResolvedValue(0)
  mockPrisma.phrase.findMany.mockResolvedValue([])
  mockPrisma.phrase.count.mockResolvedValue(0)
  mockPrisma.phrase.groupBy.mockResolvedValue([])
  mockPrisma.syncTask.findMany.mockResolvedValue([])
  mockPrisma.syncTask.findFirst.mockResolvedValue(null)
  mockPrisma.syncTask.create.mockResolvedValue({ id: 'sync-task-1' })
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

    expect(res?.status).toBe(403)
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

  it('allows bot token privileged draft access for bound platform users', async () => {
    mockGetSession.mockResolvedValue(null)
    mockVerifyApiKey.mockResolvedValue({ success: false, response: NextResponse.json({ error: 'missing' }, { status: 401 }) })
    mockPrisma.user.findFirst.mockResolvedValue({ id: 2, name: 'garth', nickname: 'Garth' })
    mockPrisma.batch.findFirst.mockResolvedValue(null)
    mockPrisma.batch.create.mockResolvedValue({
      id: 'batch-new',
      description: '键道助手草稿批次',
      status: 'Draft',
      createAt: new Date(),
      _count: { pullRequests: 0 },
    })

    const { GET } = await import('./bot/batches/latest-draft/route')
    const res = await GET(new NextRequest('http://localhost/api/bot/batches/latest-draft?platform=qq&platformId=1449533601'))

    expect(res.status).toBe(200)
    expect(mockVerifyBotToken).toHaveBeenCalled()
    expect(mockVerifyApiKey).not.toHaveBeenCalled()
    expect(mockGetSession).not.toHaveBeenCalled()
    expect(mockPrisma.batch.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ creatorId: 2 }),
    }))
  })

  it('ignores platform identity when bot token is missing', async () => {
    mockVerifyBotToken.mockResolvedValue(false)
    const { GET } = await import('./bot/batches/latest-draft/route')

    const withIdentity = await GET(new NextRequest('http://localhost/api/bot/batches/latest-draft?platform=qq&platformId=1449533601'))
    const withoutIdentity = await GET(new NextRequest('http://localhost/api/bot/batches/latest-draft'))

    expect(withIdentity.status).toBe(401)
    expect(await withIdentity.json()).toEqual({ success: false, message: '未授权' })
    expect(withoutIdentity.status).toBe(401)
    expect(await withoutIdentity.json()).toEqual({ success: false, message: '未授权' })
    expect(mockPrisma.user.findFirst).not.toHaveBeenCalled()
    expect(mockPrisma.batch.findFirst).not.toHaveBeenCalled()
  })

  it('requires bot token for scheduled GitHub auto sync', async () => {
    mockVerifyBotToken.mockResolvedValue(false)
    const { POST } = await import('./bot/sync-to-github/auto/route')

    const res = await POST(jsonRequest('http://localhost/api/bot/sync-to-github/auto', { threshold: 10 }))

    expect(res.status).toBe(401)
    expect(mockPrisma.batch.count).not.toHaveBeenCalled()
    expect(mockCreateGithubSyncService).not.toHaveBeenCalled()
  })

  it('skips scheduled GitHub auto sync below threshold', async () => {
    mockPrisma.batch.count.mockResolvedValue(10)
    const { POST } = await import('./bot/sync-to-github/auto/route')

    const res = await POST(jsonRequest('http://localhost/api/bot/sync-to-github/auto', { threshold: 10 }))
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data).toMatchObject({
      success: true,
      triggered: false,
      pendingSyncBatches: 10,
      skippedReason: 'below_threshold',
    })
    expect(mockPrisma.syncTask.findFirst).not.toHaveBeenCalled()
    expect(mockCreateGithubSyncService).not.toHaveBeenCalled()
  })

  it('releases failed auto-sync batches before counting scheduled sync work', async () => {
    mockPrisma.syncTask.findMany.mockResolvedValue([{ id: 'failed-task-1' }])
    mockPrisma.batch.updateMany.mockResolvedValue({ count: 15 })
    mockPrisma.batch.count.mockResolvedValue(10)
    const { POST } = await import('./bot/sync-to-github/auto/route')

    const res = await POST(jsonRequest('http://localhost/api/bot/sync-to-github/auto', { threshold: 10 }))
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data).toMatchObject({
      success: true,
      triggered: false,
      pendingSyncBatches: 10,
      releasedFailedBatches: 15,
      skippedReason: 'below_threshold',
    })
    expect(mockPrisma.batch.updateMany).toHaveBeenCalledWith({
      where: {
        status: 'Approved',
        syncTaskId: {
          in: ['failed-task-1'],
        },
      },
      data: {
        syncTaskId: null,
      },
    })
    expect(mockCreateGithubSyncService).not.toHaveBeenCalled()
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

  it('keeps draft batch previews publicly readable', async () => {
    mockPrisma.batch.findUnique.mockResolvedValue({ id: 'batch-1', creatorId: 2, status: 'Draft', pullRequests: [] })
    const { GET } = await import('./batches/[id]/preview/route')

    const res = await GET(new NextRequest('http://localhost/api/batches/batch-1/preview'), { params: Promise.resolve({ id: 'batch-1' }) })

    expect(res.status).toBe(200)
  })

  it('keeps draft batch details publicly readable', async () => {
    mockGetSession.mockResolvedValue(null)
    mockPrisma.batch.findUnique.mockResolvedValue({
      id: 'batch-1',
      creatorId: 2,
      status: 'Draft',
      pullRequests: [],
    })
    const { GET } = await import('./batches/[id]/route')

    const res = await GET(new NextRequest('http://localhost/api/batches/batch-1'), { params: Promise.resolve({ id: 'batch-1' }) })

    expect(res.status).toBe(200)
  })

  it('shows public AI review details after a batch is submitted', async () => {
    mockGetSession.mockResolvedValue(null)
    mockPrisma.batch.findUnique.mockResolvedValue({
      id: 'batch-1',
      creatorId: 2,
      status: 'Submitted',
      pullRequests: [{
        id: 1,
        action: 'Create',
        word: '安泊',
        oldWord: null,
        code: 'xfblo',
        type: 'Phrase',
        weight: 100,
        remark: '喵喵审词：读音 an bo；来源 汉典',
        phrase: null,
        conflicts: [],
        dependencies: [],
        dependedBy: [],
      }],
    })
    const { GET } = await import('./batches/[id]/route')

    const res = await GET(new NextRequest('http://localhost/api/batches/batch-1'), { params: Promise.resolve({ id: 'batch-1' }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.batch.aiReview.riskCounts.botReviewed).toBe(1)
    expect(data.batch.pullRequests[0].aiReview.reviewRecord.summary).toContain('喵喵审词')
    expect(mockCheckAdminPermission).not.toHaveBeenCalled()
  })

  it('does not hide draft or rejected batches from the public list', async () => {
    mockPrisma.batch.findMany.mockResolvedValue([])
    mockPrisma.batch.count.mockResolvedValue(0)
    const { GET } = await import('./batches/route')

    const res = await GET(new NextRequest('http://localhost/api/batches'))

    expect(res.status).toBe(200)
    expect(mockPrisma.batch.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { pullRequests: { some: {} } },
    }))
  })

  it('keeps draft pull request details and batch lists publicly readable', async () => {
    mockGetSession.mockResolvedValue(null)
    mockPrisma.pullRequest.findUnique.mockResolvedValue({
      id: 1,
      userId: 2,
      batch: { id: 'batch-1', creatorId: 2, status: 'Draft' },
    })
    const prDetail = await import('./pull-requests/[id]/route')

    const detailRes = await prDetail.GET(new NextRequest('http://localhost/api/pull-requests/1'), { params: Promise.resolve({ id: '1' }) })
    expect(detailRes.status).toBe(200)

    mockGetSession.mockResolvedValue({ id: 1, name: 'rea' })
    mockPrisma.batch.findUnique.mockResolvedValue({ id: 'batch-1', creatorId: 2, status: 'Draft' })
    const prList = await import('./pull-requests/route')

    const listRes = await prList.GET(new NextRequest('http://localhost/api/pull-requests?batchId=batch-1'))
    expect(listRes.status).toBe(200)
    expect(mockPrisma.pullRequest.findMany).toHaveBeenCalled()
  })

  it('requires admin for sync task history', async () => {
    mockCheckAdminPermission.mockResolvedValue({
      authorized: false,
      response: NextResponse.json({ error: '权限不足' }, { status: 403 }),
    })
    const { GET } = await import('./admin/sync-to-github/tasks/route')

    const res = await GET(new NextRequest('http://localhost/api/admin/sync-to-github/tasks'))

    expect(res?.status).toBe(403)
    expect(mockPrisma.syncTask.findMany).not.toHaveBeenCalled()
  })

  it('requires admin for manual AI batch review', async () => {
    mockCheckAdminPermission.mockResolvedValue({
      authorized: false,
      response: NextResponse.json({ error: '权限不足' }, { status: 403 }),
    })
    const { POST } = await import('./admin/batches/[id]/ai-review/route')

    const res = await POST(
      jsonRequest('http://localhost/api/admin/batches/batch-1/ai-review', { prId: 1 }),
      { params: Promise.resolve({ id: 'batch-1' }) }
    )

    expect(res?.status).toBe(403)
    expect(mockPrisma.batch.findUnique).not.toHaveBeenCalled()
  })

  it('lets admins manually rerun AI batch review', async () => {
    const botAiReview = {
      reviewer: 'Miaomiao',
      generatedAt: '2026-07-05T05:00:00.000Z',
      verdict: 'pass',
      headline: '本喵已通过 LLM 完整复审。',
      suggestedReviewNote: '本喵复审：可通过。',
      riskCounts: {
        pass: 1,
        attention: 0,
        manualReview: 0,
        botReviewed: 1,
      },
      checklist: ['已调用 keytao-bot LLM 完整复审。'],
      items: [{
        prId: 1,
        status: 'pass',
        severity: 'success',
        title: '本喵建议通过',
        reasons: ['权威读音和编码一致。'],
        suggestions: ['可以批准。'],
        reviewRecord: {
          reviewedBy: 'Miaomiao',
          source: 'bot-llm',
          summary: '本喵建议通过',
          pronunciation: 'an bo',
          sources: ['汉典'],
          evidence: ['读音：an bo', '来源：汉典'],
        },
      }],
      codeChains: [],
    }
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, aiReview: botAiReview }),
    } as Response)
    mockPrisma.batch.findUnique.mockResolvedValue({
      id: 'batch-1',
      status: 'Submitted',
      creator: { id: 1, name: 'rea', nickname: 'Rea' },
      sourceIssue: null,
      pullRequests: [{
        id: 1,
        action: 'Create',
        word: '安泊',
        oldWord: null,
        code: 'xfblo',
        type: 'Phrase',
        weight: 100,
        remark: '喵喵审词：读音 an bo；来源 汉典',
        phrase: null,
        conflicts: [],
        dependencies: [],
      }],
    })
    const { POST } = await import('./admin/batches/[id]/ai-review/route')

    const res = await POST(
      jsonRequest('http://localhost/api/admin/batches/batch-1/ai-review', { prId: 1 }),
      { params: Promise.resolve({ id: 'batch-1' }) }
    )
    const data = await res?.json()

    expect(res?.status).toBe(200)
    expect(data?.aiReview.riskCounts.botReviewed).toBe(1)
    expect(data?.focusItem).toMatchObject({ prId: 1 })
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/keytao/batches/review',
      expect.objectContaining({ method: 'POST' })
    )
    expect(mockPrisma.pullRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 1 },
      data: expect.objectContaining({
        remark: expect.stringContaining('本喵复审：通过'),
      }),
    }))
    const persistedRemark = mockPrisma.pullRequest.update.mock.calls[0]?.[0]?.data?.remark
    expect(persistedRemark).toContain('读音：an bo')
    expect(persistedRemark).toContain('来源：汉典')
    expect(persistedRemark).not.toContain('证据：读音：an bo')
    expect(persistedRemark).not.toContain('证据：来源：汉典')
    expect(mockPrisma.batch.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'batch-1' },
      data: { reviewNote: '本喵复审：可通过。' },
    }))
    expect(mockCheckBatchConflictsWithWeight).toHaveBeenCalled()
  })

  it('keeps sync task history publicly readable', async () => {
    mockGetSession.mockResolvedValue(null)
    mockPrisma.syncTask.findMany.mockResolvedValue([])
    mockPrisma.syncTask.count.mockResolvedValue(0)
    const { GET } = await import('./sync-to-github/tasks/route')

    const res = await GET(new NextRequest('http://localhost/api/sync-to-github/tasks?page=1&pageSize=10'))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      tasks: [],
      pagination: {
        page: 1,
        pageSize: 10,
        total: 0,
        totalPages: 0,
      },
    })
    expect(mockCheckAdminPermission).not.toHaveBeenCalled()
    expect(mockPrisma.syncTask.findMany).toHaveBeenCalled()
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

    const byCodeRes = await byCode.GET(new NextRequest(`http://localhost/api/phrases/by-code?code=${'x'.repeat(21)}`))
    const byWordRes = await byWord.GET(new NextRequest(`http://localhost/api/phrases/by-word?word=${'x'.repeat(101)}`))

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

  it('rejects long issues and unsafe sync file names', async () => {
    const issues = await import('./issues/route')
    const issueRes = await issues.POST(jsonRequest('http://localhost/api/issues', {
      title: 'x'.repeat(121),
      content: 'body',
    }))

    expect(issueRes.status).toBe(400)
    expect(mockPrisma.issue.create).not.toHaveBeenCalled()

    const commitBatch = await import('./admin/sync-to-github/commit-batch/route')
    const commitRes = await commitBatch.POST(jsonRequest('http://localhost/api/admin/sync-to-github/commit-batch', {
      taskId: 'task-1',
      files: [{ name: '../evil.dict.yaml', content: 'x' }],
      processedCount: 1,
      totalCount: 1,
    }))

    expect(commitRes?.status).toBe(400)
    expect(mockPrisma.syncTask.findUnique).not.toHaveBeenCalled()
  })

  it('rate limits install download before proxying upstream', async () => {
    mockCheckRateLimit.mockReturnValue({ allowed: false, retryAfterMs: 900 })
    const { GET } = await import('./install/download/route')

    const res = await GET(new NextRequest('http://localhost/api/install/download?url=https://github.com/xkinput/KeyTao/releases/download/v1/keytao.zip'))

    expect(res.status).toBe(429)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects oversized conflict-check batches', async () => {
    const { POST } = await import('./pull-requests/check-conflicts-batch/route')
    const items = Array.from({ length: 501 }, () => draftItem())

    const res = await POST(jsonRequest('http://localhost/api/pull-requests/check-conflicts-batch', { items }))

    expect(res.status).toBe(400)
    expect(mockCheckBatchConflictsWithWeight).not.toHaveBeenCalled()
  })

  it('rejects oversized personal API draft batches', async () => {
    const { POST } = await import('./v1/pull-requests/batch-draft/route')
    const items = Array.from({ length: 501 }, () => draftItem())

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
