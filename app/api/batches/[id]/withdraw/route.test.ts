import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'
import { POST as withdrawViaApiKey } from '@/app/api/v1/batches/[id]/withdraw/route'

const mocks = vi.hoisted(() => {
  const tx = {
    batch: {
      updateMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
  }
  return {
    getSession: vi.fn(),
    checkRateLimit: vi.fn(),
    tx,
    prisma: {
      apiKey: { findUnique: vi.fn(), update: vi.fn() },
      batch: { findUnique: vi.fn() },
      $transaction: vi.fn(),
    },
  }
})

vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/rateLimit', () => ({ checkRateLimit: mocks.checkRateLimit }))
vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))

const legacyPath = '/api/batches/batch-1/withdraw'
const v1Path = '/api/v1/batches/batch-1/withdraw'
const context = { params: Promise.resolve({ id: 'batch-1' }) }
const apiKeyHeaders = { 'X-API-Key': 'kt_withdraw_test_key' }
const apiKeyRecord = { id: 9, userId: 1, enabled: true, user: { status: 'ENABLE' } }
const submittedBatch = { id: 'batch-1', creatorId: 1, status: 'Submitted', contentVersion: 4 }
const withdrawnBatch = { ...submittedBatch, status: 'Draft', contentVersion: 5 }

function createRequest(path: string, headers?: HeadersInit) {
  return new NextRequest(`http://localhost${path}`, { method: 'POST', headers })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getSession.mockResolvedValue({ id: 1 })
  mocks.checkRateLimit.mockReturnValue({ allowed: true, retryAfterMs: 0 })
  mocks.prisma.apiKey.findUnique.mockResolvedValue(apiKeyRecord)
  mocks.prisma.apiKey.update.mockResolvedValue({})
  mocks.prisma.batch.findUnique.mockResolvedValue(submittedBatch)
  mocks.prisma.$transaction.mockImplementation(async (callback) => callback(mocks.tx))
  mocks.tx.batch.updateMany.mockResolvedValue({ count: 1 })
  mocks.tx.batch.findUniqueOrThrow.mockResolvedValue(withdrawnBatch)
})

describe('POST /api/batches/[id]/withdraw', () => {
  it('withdraws only the exact submitted snapshot', async () => {
    const response = await POST(createRequest(legacyPath), context)

    expect(response.status).toBe(200)
    expect(mocks.tx.batch.updateMany).toHaveBeenCalledWith({
      where: { id: 'batch-1', creatorId: 1, status: 'Submitted', contentVersion: 4, itemReviewStarted: false },
      data: { status: 'Draft', contentVersion: { increment: 1 } },
    })
  })

  it('does not undo an approval that won the race', async () => {
    mocks.tx.batch.updateMany.mockResolvedValue({ count: 0 })
    const response = await POST(createRequest(legacyPath), context)

    expect(response.status).toBe(409)
    expect(mocks.tx.batch.findUniqueOrThrow).not.toHaveBeenCalled()
  })
})

it.each([
  { path: legacyPath, handler: POST },
  { path: v1Path, handler: withdrawViaApiKey },
])('withdraws a submitted batch via X-API-Key on $path', async ({ path, handler }) => {
  mocks.getSession.mockResolvedValue(null)
  const response = await handler(createRequest(path, apiKeyHeaders), context)

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ batch: withdrawnBatch })
  expect(mocks.tx.batch.updateMany).toHaveBeenCalledWith({
    where: { id: 'batch-1', creatorId: 1, status: 'Submitted', contentVersion: 4, itemReviewStarted: false },
    data: { status: 'Draft', contentVersion: { increment: 1 } },
  })
})

describe('POST /api/v1/batches/[id]/withdraw', () => {
  it('requires X-API-Key even when a Bearer token is provided', async () => {
    const response = await withdrawViaApiKey(
      createRequest(v1Path, { Authorization: 'Bearer test-token' }), context,
    )

    expect(response.status).toBe(401)
    expect(mocks.getSession).not.toHaveBeenCalled()
    expect(mocks.prisma.batch.findUnique).not.toHaveBeenCalled()
  })

  it.each([
    { name: 'invalid key', record: null, status: 401 },
    { name: 'disabled key', record: { ...apiKeyRecord, enabled: false }, status: 403 },
    { name: 'banned account', record: { ...apiKeyRecord, user: { status: 'BANNED' } }, status: 403 },
  ])('rejects a $name before loading a batch', async ({ record, status }) => {
    mocks.prisma.apiKey.findUnique.mockResolvedValue(record)
    const response = await withdrawViaApiKey(createRequest(v1Path, apiKeyHeaders), context)

    expect(response.status).toBe(status)
    expect(mocks.prisma.batch.findUnique).not.toHaveBeenCalled()
  })

  it.each([
    { name: 'missing batch', batch: null, status: 404 },
    { name: 'another user batch', batch: { ...submittedBatch, creatorId: 2 }, status: 403 },
    { name: 'approved batch', batch: { ...submittedBatch, status: 'Approved' }, status: 400 },
  ])('does not withdraw a $name', async ({ batch, status }) => {
    mocks.prisma.batch.findUnique.mockResolvedValue(batch)
    const response = await withdrawViaApiKey(createRequest(v1Path, apiKeyHeaders), context)

    expect(response.status).toBe(status)
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })
})
