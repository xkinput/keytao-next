import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  checkConflicts: vi.fn(),
  skippedWarnings: vi.fn(),
  warningDigest: vi.fn(),
  batchFindUnique: vi.fn(),
  batchFindFirst: vi.fn(),
  batchCreate: vi.fn(),
  pullRequestFindMany: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@/lib/botUserAuth', () => ({
  requireVerifiedBotUser: mocks.authorize,
}))
vi.mock('@/lib/services/batchConflictService', () => ({
  checkBatchConflictsWithWeight: mocks.checkConflicts,
}))
vi.mock('@/lib/services/batchSkippedCodeWarnings', () => ({
  buildSkippedCandidateSlotWarnings: mocks.skippedWarnings,
}))
vi.mock('@/lib/services/botWarningSnapshot', () => ({
  buildBotWarningDigest: mocks.warningDigest,
  lockPhraseTableForWarningSnapshot: vi.fn(),
}))
vi.mock('@/lib/services/batchContentGuard', () => ({
  BatchContentLockedError: class BatchContentLockedError extends Error {
    readonly status = 409
  },
  assertNoBotDraftBatch: vi.fn(),
  assertNoOtherBotDraftWithContent: vi.fn(),
  claimBatchContentMutation: vi.fn(),
  lockBotDraftUser: vi.fn(),
}))
vi.mock('@/lib/services/batchDependencyService', () => ({
  buildDependencies: vi.fn(),
}))
vi.mock('@/lib/services/phraseTargetBinding', () => ({
  createPhraseTargetFingerprint: vi.fn(() => 'fingerprint'),
}))
vi.mock('@/lib/services/batchDeleteTargets', () => ({
  assertExpectedBatchTargets: vi.fn(),
  BatchTargetChangedError: class BatchTargetChangedError extends Error {
    readonly status = 409
  },
  parseExpectedBatchTargets: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    batch: {
      findUnique: mocks.batchFindUnique,
      findFirst: mocks.batchFindFirst,
      create: mocks.batchCreate,
    },
    pullRequest: {
      findMany: mocks.pullRequestFindMany,
    },
    $transaction: mocks.transaction,
  },
}))

const cleanConflict = {
  id: '0',
  conflict: {
    hasConflict: false,
    impact: '',
    currentPhrase: null,
    suggestions: [],
  },
}

function request(path: string, body: Record<string, unknown>) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.authorize.mockResolvedValue({
    authorized: true,
    user: { id: 7, name: 'tester' },
    platform: 'qq',
  })
  mocks.checkConflicts.mockResolvedValue([cleanConflict])
  mocks.skippedWarnings.mockResolvedValue([])
  mocks.warningDigest.mockResolvedValue('a'.repeat(64))
  mocks.batchFindUnique.mockResolvedValue({
    id: 'batch-1',
    creatorId: 7,
    status: 'Draft',
    contentVersion: 4,
  })
  mocks.batchFindFirst.mockResolvedValue(null)
  mocks.pullRequestFindMany.mockResolvedValue([])
})

describe('bot draft mutations require a server ticket', () => {
  it('keeps a clean regular batch request read-only when previewOnly is omitted', async () => {
    const { POST } = await import('./batch/route')
    const response = await POST(request('/api/bot/pull-requests/batch', {
      platform: 'qq',
      platformId: 'user-7',
      batchId: 'batch-1',
      items: [{ action: 'Create', word: '测试', code: 'ces', type: 'Phrase' }],
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      success: false,
      requiresConfirmation: true,
      batchId: 'batch-1',
      contentVersion: 4,
      warningDigest: 'a'.repeat(64),
    })
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('keeps a clean tolerant batch request read-only and does not create a draft', async () => {
    mocks.batchFindUnique.mockResolvedValue(null)
    const { POST } = await import('./batch-draft/route')
    const response = await POST(request('/api/bot/pull-requests/batch-draft', {
      platform: 'qq',
      platformId: 'user-7',
      items: [{ action: 'Create', word: '测试', code: 'ces', type: 'Phrase' }],
    }))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toMatchObject({
      success: false,
      requiresConfirmation: true,
      contentVersion: 0,
      warningDigest: 'a'.repeat(64),
    })
    expect(body.batchId).toMatch(/^[0-9a-f-]{36}$/)
    expect(mocks.batchCreate).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
})

describe('the regular batch route resolves the same draft the reads report', () => {
  it('uses the shared current-draft selector when no batchId is given', async () => {
    mocks.batchFindFirst.mockResolvedValue({
      id: 'batch-with-content', description: '键道助手草稿批次', createAt: new Date(),
      contentVersion: 6, _count: { pullRequests: 2 },
    })

    const { POST } = await import('./batch/route')
    const response = await POST(request('/api/bot/pull-requests/batch', {
      platform: 'qq',
      platformId: 'user-7',
      items: [{ action: 'Create', word: '测试', code: 'ces', type: 'Phrase' }],
    }))
    const body = await response.json()

    expect(mocks.batchFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ creatorId: 7, pullRequests: { some: {} } }),
    }))
    expect(body).toMatchObject({
      requiresConfirmation: true,
      batchId: 'batch-with-content',
      contentVersion: 6,
    })
    // No explicit id was sent, so nothing may be looked up by id.
    expect(mocks.batchFindUnique).not.toHaveBeenCalled()
  })

  it('hashes a not-yet-created batch against the shared identity', async () => {
    mocks.batchFindFirst.mockResolvedValue(null)

    const { POST } = await import('./batch/route')
    const response = await POST(request('/api/bot/pull-requests/batch', {
      platform: 'qq',
      platformId: 'user-7',
      items: [{ action: 'Create', word: '测试', code: 'ces', type: 'Phrase' }],
    }))
    const body = await response.json()
    const warningState = mocks.warningDigest.mock.calls.at(-1)?.[2] as { targetBatchId: string }

    expect(body).toMatchObject({ requiresConfirmation: true, contentVersion: 0 })
    expect(body.batchId).toMatch(/^[0-9a-f-]{36}$/)
    expect(warningState.targetBatchId).toBe('new-bot-draft-batch')
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
})
