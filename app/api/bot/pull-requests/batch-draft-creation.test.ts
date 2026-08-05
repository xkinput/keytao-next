import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Batch creation belongs to the write path only.
 *
 * `GET /api/bot/batches/latest-draft` no longer creates anything, so the first
 * write for a user who has no draft must materialise one: the unconfirmed
 * preview hands out a provisional batch id, and the confirmed write creates
 * that exact batch inside the write transaction.
 */

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  checkConflicts: vi.fn(),
  skippedWarnings: vi.fn(),
  warningDigest: vi.fn(),
  batchFindUnique: vi.fn(),
  batchFindFirst: vi.fn(),
  batchCreate: vi.fn(),
  txBatchCreate: vi.fn(),
  pullRequestFindMany: vi.fn(),
  pullRequestCreate: vi.fn(),
  claimBatchContentMutation: vi.fn(),
  assertNoBotDraftBatch: vi.fn(),
}))

vi.mock('@/lib/botUserAuth', () => ({ requireVerifiedBotUser: mocks.authorize }))
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
  assertNoBotDraftBatch: mocks.assertNoBotDraftBatch,
  assertNoOtherBotDraftWithContent: vi.fn(),
  claimBatchContentMutation: mocks.claimBatchContentMutation,
  lockBotDraftUser: vi.fn(),
}))
vi.mock('@/lib/services/batchDeleteTargets', () => ({
  assertExpectedBatchTargets: vi.fn(),
  BatchTargetChangedError: class BatchTargetChangedError extends Error {
    readonly status = 409
  },
  parseExpectedBatchTargets: vi.fn(),
}))
vi.mock('@/lib/services/phraseTargetBinding', () => ({
  createPhraseTargetFingerprint: vi.fn(() => 'fingerprint'),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    batch: {
      findUnique: mocks.batchFindUnique,
      findFirst: mocks.batchFindFirst,
      create: mocks.batchCreate,
    },
    pullRequest: { findMany: mocks.pullRequestFindMany },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({
      batch: { create: mocks.txBatchCreate },
      pullRequest: { create: mocks.pullRequestCreate },
      phrase: { findFirst: vi.fn() },
    }),
  },
}))

const DIGEST = 'a'.repeat(64)

function post(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/bot/pull-requests/batch-draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const ITEM = { action: 'Create', word: '吃席', code: 'wkxk', type: 'Phrase' }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.authorize.mockResolvedValue({ authorized: true, user: { id: 7, name: 'tester' }, platform: 'qq' })
  mocks.checkConflicts.mockResolvedValue([{
    id: '0',
    conflict: { hasConflict: false, impact: '', currentPhrase: null, suggestions: [] },
  }])
  mocks.skippedWarnings.mockResolvedValue([])
  mocks.warningDigest.mockResolvedValue(DIGEST)
  mocks.batchFindFirst.mockResolvedValue(null)
  mocks.batchFindUnique.mockResolvedValue(null)
  // Fresh array per call: the route appends to the rows it reads back, so a
  // shared instance would make the second request see a phantom duplicate.
  mocks.pullRequestFindMany.mockImplementation(async () => [])
  mocks.pullRequestCreate.mockResolvedValue({ id: 1 })
})

describe('first write creates the draft batch on demand', () => {
  it('previews with a provisional batch id and writes nothing', async () => {
    const { POST } = await import('./batch-draft/route')
    const res = await POST(post({ platform: 'qq', platformId: 'u-1', items: [ITEM] }))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body).toMatchObject({ success: false, requiresConfirmation: true, contentVersion: 0 })
    expect(body.batchId).toMatch(/^[0-9a-f-]{36}$/)
    expect(mocks.batchCreate).not.toHaveBeenCalled()
    expect(mocks.txBatchCreate).not.toHaveBeenCalled()
  })

  it('materialises exactly that batch when the write is confirmed', async () => {
    const { POST } = await import('./batch-draft/route')
    const preview = await (await POST(post({ platform: 'qq', platformId: 'u-1', items: [ITEM] }))).json()

    mocks.batchFindUnique.mockResolvedValueOnce(null)
    mocks.batchFindUnique.mockResolvedValueOnce({ contentVersion: 1, pullRequests: [] })

    const res = await POST(post({
      platform: 'qq',
      platformId: 'u-1',
      items: [ITEM],
      batchId: preview.batchId,
      confirmed: true,
      expectedContentVersion: 0,
      expectedWarningDigest: DIGEST,
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ success: true, batchId: preview.batchId, successCount: 1 })
    expect(mocks.txBatchCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        id: preview.batchId,
        creatorId: 7,
        status: 'Draft',
        description: '键道助手草稿批次',
      }),
    }))
    expect(mocks.pullRequestCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ word: '吃席', code: 'wkxk', batchId: preview.batchId }),
    }))
  })

  it('accepts a confirmed write with no batchId and version 0 as the "no draft yet" CAS', async () => {
    // This is the shift (顺延) case: the caller planned against "user has no
    // draft", so it can confirm in a single call without inventing a batch id.
    mocks.batchFindUnique.mockResolvedValueOnce({ contentVersion: 1, pullRequests: [] })

    const { POST } = await import('./batch-draft/route')
    const res = await POST(post({
      platform: 'qq',
      platformId: 'u-1',
      items: [ITEM],
      confirmed: true,
      expectedContentVersion: 0,
      expectedWarningDigest: DIGEST,
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ success: true, successCount: 1 })
    expect(body.batchId).toMatch(/^[0-9a-f-]{36}$/)
    // The absence is re-checked under the write lock before creating.
    expect(mocks.assertNoBotDraftBatch).toHaveBeenCalledWith(expect.anything(), 7)
    expect(mocks.txBatchCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ id: body.batchId, creatorId: 7, status: 'Draft' }),
    }))
  })

  it('hashes preview and confirm against the same "not created yet" identity', async () => {
    const { POST } = await import('./batch-draft/route')
    await POST(post({ platform: 'qq', platformId: 'u-1', items: [ITEM] }))
    const previewState = mocks.warningDigest.mock.calls.at(-1)?.[2] as { targetBatchId: string }

    mocks.batchFindUnique.mockResolvedValueOnce({ contentVersion: 1, pullRequests: [] })
    await POST(post({
      platform: 'qq',
      platformId: 'u-1',
      items: [ITEM],
      confirmed: true,
      expectedContentVersion: 0,
      expectedWarningDigest: DIGEST,
    }))
    const confirmState = mocks.warningDigest.mock.calls.at(-1)?.[2] as { targetBatchId: string }

    // A provisional UUID differs on every call, so hashing it would make the
    // ticket unusable; both phases must hash the shared identity instead.
    expect(previewState.targetBatchId).toBe('new-bot-draft-batch')
    expect(confirmState.targetBatchId).toBe('new-bot-draft-batch')
  })

  it('rejects the "no draft yet" CAS when a draft showed up meanwhile', async () => {
    mocks.batchFindFirst.mockResolvedValue({
      id: 'raced-draft', description: '键道助手草稿批次', createAt: new Date(),
      contentVersion: 3, _count: { pullRequests: 1 },
    })

    const { POST } = await import('./batch-draft/route')
    const res = await POST(post({
      platform: 'qq',
      platformId: 'u-1',
      items: [ITEM],
      confirmed: true,
      expectedContentVersion: 0,
      expectedWarningDigest: DIGEST,
    }))

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ success: false, message: '批次内容已被修改，请刷新后重试' })
    expect(mocks.txBatchCreate).not.toHaveBeenCalled()
  })

  it('still requires a batchId for any non-zero expected version', async () => {
    const { POST } = await import('./batch-draft/route')
    const res = await POST(post({
      platform: 'qq',
      platformId: 'u-1',
      items: [ITEM],
      confirmed: true,
      expectedContentVersion: 5,
      expectedWarningDigest: DIGEST,
    }))

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ message: 'expectedContentVersion 必须与 batchId 一起提供' })
  })

  it('writes into the draft that holds content rather than a newer empty one', async () => {
    // The shared selector asks for "a draft with content" first; that is the
    // batch an implicit (batchId-less) write must target.
    mocks.batchFindFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => (
      where.pullRequests
        ? { id: '785e0368', description: '键道助手草稿批次', createAt: new Date(), contentVersion: 5, _count: { pullRequests: 1 } }
        : { id: 'ec511ac6', description: '键道助手草稿批次', createAt: new Date(), contentVersion: 0, _count: { pullRequests: 0 } }
    ))

    const { POST } = await import('./batch-draft/route')
    const body = await (await POST(post({ platform: 'qq', platformId: 'u-1', items: [ITEM] }))).json()

    expect(body).toMatchObject({ batchId: '785e0368', contentVersion: 5 })
    expect(mocks.batchCreate).not.toHaveBeenCalled()
  })
})
