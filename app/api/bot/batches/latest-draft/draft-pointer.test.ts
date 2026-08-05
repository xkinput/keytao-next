import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Regression for the "current draft pointer drifted" incident:
 *
 *   batch A gets an item -> A is submitted for review -> a read-only preview
 *   runs -> A is recalled -> the draft the bot shows must still be A, with the
 *   item in it.
 *
 * Before the fix, the read-only preview created an empty batch B, `createAt
 * desc` made B the "current draft", and A's item became invisible to every
 * read path even though the recall itself succeeded.
 *
 * The prisma mock below is a tiny in-memory store so the whole sequence runs
 * through the real route handlers.
 */

type StoredItem = {
  id: number
  action: string
  word: string
  oldWord: string | null
  code: string
  type: string
  remark: string | null
  weight: number | null
  status: string
  createAt: Date
  conflictReason: string | null
}

type StoredBatch = {
  id: string
  creatorId: number
  status: string
  description: string
  createAt: Date
  updateAt: Date
  contentVersion: number
  items: StoredItem[]
}

const store: { batches: StoredBatch[] } = { batches: [] }

type Where = Record<string, unknown>

function matches(batch: StoredBatch, where: Where | undefined): boolean {
  if (!where) return true
  for (const [key, condition] of Object.entries(where)) {
    if (condition === undefined) continue
    if (key === 'pullRequests') {
      if (batch.items.length === 0) return false
      continue
    }
    if (key === 'description') {
      const prefix = (condition as { startsWith?: string }).startsWith
      if (prefix && !batch.description.startsWith(prefix)) return false
      continue
    }
    if (key === 'status' && typeof condition === 'object' && condition !== null) {
      const allowed = (condition as { in: string[] }).in
      if (!allowed.includes(batch.status)) return false
      continue
    }
    if (batch[key as keyof StoredBatch] !== condition) return false
  }
  return true
}

function project(batch: StoredBatch) {
  return {
    id: batch.id,
    creatorId: batch.creatorId,
    status: batch.status,
    description: batch.description,
    createAt: batch.createAt,
    updateAt: batch.updateAt,
    contentVersion: batch.contentVersion,
    _count: { pullRequests: batch.items.length },
    pullRequests: batch.items,
  }
}

const findFirst = vi.fn(async ({ where, orderBy }: { where?: Where; orderBy?: Record<string, string> }) => {
  const field = orderBy && 'updateAt' in orderBy ? 'updateAt' : 'createAt'
  const rows = store.batches
    .filter(batch => matches(batch, where))
    .sort((a, b) => b[field].getTime() - a[field].getTime())
  return rows[0] ? project(rows[0]) : null
})

const findUnique = vi.fn(async ({ where }: { where: { id: string } }) => {
  const row = store.batches.find(batch => batch.id === where.id)
  return row ? project(row) : null
})

const pullRequestFindMany = vi.fn(async ({ where }: { where: { batchId: string } }) => {
  return store.batches.find(batch => batch.id === where.batchId)?.items ?? []
})

const phraseFindMany = vi.fn(async () => [])

const updateMany = vi.fn(async ({ where, data }: { where: Where; data: Record<string, unknown> }) => {
  const rows = store.batches.filter(batch => matches(batch, where))
  for (const row of rows) {
    for (const [key, value] of Object.entries(data)) {
      if (
        key === 'contentVersion'
        && typeof value === 'object'
        && value !== null
        && typeof (value as { increment?: unknown }).increment === 'number'
      ) {
        row.contentVersion += (value as { increment: number }).increment
      } else {
        Object.assign(row, { [key]: value })
      }
    }
    row.updateAt = new Date()
  }
  return { count: rows.length }
})

const batchCreate = vi.fn(async () => {
  throw new Error('no read path may create a batch')
})

vi.mock('@/lib/prisma', () => ({
  prisma: {
    batch: { findFirst, findUnique, updateMany, create: batchCreate },
    phrase: { findMany: phraseFindMany },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({
      batch: { findFirst, findUnique, updateMany, create: batchCreate },
      pullRequest: { findMany: pullRequestFindMany },
      phrase: { findMany: phraseFindMany },
      $executeRawUnsafe: async () => undefined,
    }),
  },
}))

const mockRequireVerifiedBotUser = vi.fn()
vi.mock('@/lib/botUserAuth', () => ({ requireVerifiedBotUser: mockRequireVerifiedBotUser }))
vi.mock('@/lib/services/batchConflictService', () => ({
  checkBatchConflictsWithWeight: vi.fn(async () => []),
}))
vi.mock('@/lib/services/batchSubmitWarnings', () => ({
  buildBatchSubmitWarnings: vi.fn(() => []),
}))
vi.mock('@/lib/services/batchSkippedCodeWarnings', () => ({
  buildSkippedCandidateSlotWarnings: vi.fn(async () => []),
  collectSkippedCandidateSlotDependencies: vi.fn(async () => []),
}))
vi.mock('@/lib/services/batchPriorityOrderWarnings', () => ({
  buildPriorityOrderWarnings: vi.fn(async () => []),
}))

const USER_ID = 42
const IDENTITY = 'platform=qq&platformId=u-1'

function item(overrides: Partial<StoredItem> = {}): StoredItem {
  return {
    id: 1,
    action: 'Create',
    word: '吃席',
    oldWord: null,
    code: 'wkxk',
    type: 'Phrase',
    remark: null,
    weight: null,
    status: 'Pending',
    createAt: new Date('2026-08-04T16:30:00.000Z'),
    conflictReason: null,
    ...overrides,
  }
}

async function readLatestDraft() {
  const { GET } = await import('./route')
  const res = await GET(new NextRequest(`http://localhost/api/bot/batches/latest-draft?${IDENTITY}`))
  return { status: res.status, body: await res.json() }
}

async function readDraftItems() {
  const { GET } = await import('./items/route')
  const res = await GET(new NextRequest(`http://localhost/api/bot/batches/latest-draft/items?${IDENTITY}`))
  return { status: res.status, body: await res.json() }
}

async function recall(batchId: string, expectedContentVersion: number) {
  const { POST } = await import('../recall/route')
  const res = await POST(new NextRequest('http://localhost/api/bot/batches/recall', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ platform: 'qq', platformId: 'u-1', batchId, expectedContentVersion }),
  }))
  return { status: res.status, body: await res.json() }
}

async function submit(batchId: string, expectedContentVersion: number) {
  const { POST } = await import('../[id]/submit/route')
  const preview = await POST(new NextRequest(`http://localhost/api/bot/batches/${batchId}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform: 'qq', platformId: 'u-1', expectedContentVersion, previewOnly: true,
    }),
  }), { params: Promise.resolve({ id: batchId }) })
  const previewBody = await preview.json()
  const confirmed = await POST(new NextRequest(`http://localhost/api/bot/batches/${batchId}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform: 'qq',
      platformId: 'u-1',
      expectedContentVersion,
      expectedWarningDigest: previewBody.warningDigest,
      expectedSnapshotDigest: previewBody.snapshotDigest,
      confirmed: true,
    }),
  }), { params: Promise.resolve({ id: batchId }) })
  return { status: confirmed.status, body: await confirmed.json() }
}

beforeEach(() => {
  vi.clearAllMocks()
  store.batches = []
  mockRequireVerifiedBotUser.mockResolvedValue({ authorized: true, user: { id: USER_ID } })
})

describe('current draft pointer survives submit + read + recall', () => {
  it('ages the snapshot across a Draft -> Submitted -> Draft round trip', async () => {
    store.batches.push({
      id: 'round-trip',
      creatorId: USER_ID,
      status: 'Draft',
      description: '键道助手草稿批次',
      createAt: new Date('2026-08-04T16:00:00.000Z'),
      updateAt: new Date('2026-08-04T16:30:00.000Z'),
      contentVersion: 1,
      items: [item()],
    })

    const submitted = await submit('round-trip', 1)
    expect(submitted.status).toBe(200)
    expect(submitted.body.batch).toMatchObject({ status: 'Submitted', contentVersion: 2 })

    const recalled = await recall('round-trip', 2)
    expect(recalled.status).toBe(200)
    expect(recalled.body).toMatchObject({ status: 'Draft', contentVersion: 3 })
    expect(store.batches[0]).toMatchObject({ status: 'Draft', contentVersion: 3 })
  })

  it('keeps the recalled batch and its items reachable', async () => {
    // T0: batch A holds the user's word and is submitted for review.
    store.batches.push({
      id: '785e0368',
      creatorId: USER_ID,
      status: 'Submitted',
      description: '键道助手草稿批次',
      createAt: new Date('2026-08-04T16:00:00.000Z'),
      updateAt: new Date('2026-08-04T16:30:00.000Z'),
      contentVersion: 2,
      items: [item()],
    })

    // T1: a read-only preview. This is where the empty shadow batch used to be
    // born; the prisma mock throws if any read path creates one.
    const preview = await readLatestDraft()
    expect(preview.body).toMatchObject({ success: true, batchId: null, exists: false })
    expect(batchCreate).not.toHaveBeenCalled()
    expect(store.batches).toHaveLength(1)

    // T2: the user recalls the submission.
    const recalled = await recall('785e0368', 2)
    expect(recalled.status).toBe(200)
    expect(recalled.body).toMatchObject({
      success: true, batchId: '785e0368', contentVersion: 3,
    })

    // T3: the current draft must be A again, with the word still in it.
    const afterRecall = await readLatestDraft()
    expect(afterRecall.body).toMatchObject({
      success: true,
      batchId: '785e0368',
      exists: true,
      pullRequestCount: 1,
    })

    const items = await readDraftItems()
    expect(items.body).toMatchObject({ batchId: '785e0368', count: 1 })
    expect(items.body.items[0]).toMatchObject({ word: '吃席', code: 'wkxk' })
  })

  it('is not shadowed by an empty draft created after the submission', async () => {
    // Same sequence, but a stray empty draft already exists (the historical
    // ec511ac6, or any draft left empty by deleting its items).
    store.batches.push({
      id: '785e0368',
      creatorId: USER_ID,
      status: 'Submitted',
      description: '键道助手草稿批次',
      createAt: new Date('2026-08-04T16:00:00.000Z'),
      updateAt: new Date('2026-08-04T16:30:00.000Z'),
      contentVersion: 2,
      items: [item()],
    })
    store.batches.push({
      id: 'ec511ac6',
      creatorId: USER_ID,
      status: 'Draft',
      description: '键道助手草稿批次',
      createAt: new Date('2026-08-04T16:37:00.000Z'),
      updateAt: new Date('2026-08-04T16:37:00.000Z'),
      contentVersion: 0,
      items: [],
    })

    // The empty batch is the only draft, so it is what a read reports...
    expect((await readLatestDraft()).body).toMatchObject({ batchId: 'ec511ac6', pullRequestCount: 0 })

    // ...and it must not block the recall (it holds no content).
    expect((await recall('785e0368', 2)).status).toBe(200)

    // After the recall the batch with content owns the pointer, in both
    // endpoints, even though the empty one was created later.
    expect((await readLatestDraft()).body).toMatchObject({
      batchId: '785e0368',
      pullRequestCount: 1,
    })
    const items = await readDraftItems()
    expect(items.body).toMatchObject({ batchId: '785e0368', count: 1 })
    expect(items.body.items[0]).toMatchObject({ word: '吃席' })
    expect(batchCreate).not.toHaveBeenCalled()
  })

  it('still blocks a recall when another draft already holds content', async () => {
    store.batches.push({
      id: '785e0368',
      creatorId: USER_ID,
      status: 'Submitted',
      description: '键道助手草稿批次',
      createAt: new Date('2026-08-04T16:00:00.000Z'),
      updateAt: new Date('2026-08-04T16:30:00.000Z'),
      contentVersion: 2,
      items: [item()],
    })
    store.batches.push({
      id: 'later-draft',
      creatorId: USER_ID,
      status: 'Draft',
      description: '键道助手草稿批次',
      createAt: new Date('2026-08-04T16:37:00.000Z'),
      updateAt: new Date('2026-08-04T16:37:00.000Z'),
      contentVersion: 1,
      items: [item({ id: 2, word: '赤溪', code: 'wkxkv' })],
    })

    const blocked = await recall('785e0368', 2)
    expect(blocked.status).toBe(400)
    expect(store.batches.find(batch => batch.id === '785e0368')?.status).toBe('Submitted')
  })
})
