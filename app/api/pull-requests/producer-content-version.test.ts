import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => {
  const tx = {
    batch: { updateMany: vi.fn() },
    pullRequest: {
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    codeConflict: {
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    phrase: { findFirst: vi.fn() },
  }
  return {
    getSession: vi.fn(),
    checkIsAdmin: vi.fn(),
    checkConflict: vi.fn(),
    resolvePhraseTargetBinding: vi.fn(),
    tx,
    prisma: {
      batch: {
        findUnique: vi.fn(),
        create: vi.fn(),
      },
      pullRequest: { findUnique: vi.fn() },
      phrase: { findFirst: vi.fn() },
      $transaction: vi.fn(),
    },
  }
})

vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/adminAuth', () => ({ checkIsAdmin: mocks.checkIsAdmin }))
vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('@/lib/services/conflictDetector', () => ({
  conflictDetector: { checkConflict: mocks.checkConflict },
}))
vi.mock('@/lib/services/phraseTargetBinding', () => ({
  resolvePhraseTargetBinding: mocks.resolvePhraseTargetBinding,
}))
vi.mock('@/lib/services/batchDependencyService', () => ({
  rebuildBatchDependencies: vi.fn(async () => true),
}))

function jsonRequest(url: string, method: string, body: unknown) {
  return new NextRequest(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const validItem = {
  action: 'Create',
  word: '测试',
  code: 'ces',
  type: 'Phrase',
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getSession.mockResolvedValue({ id: 1 })
  mocks.checkIsAdmin.mockResolvedValue(false)
  mocks.checkConflict.mockResolvedValue({ hasConflict: false, suggestions: [] })
  mocks.resolvePhraseTargetBinding.mockResolvedValue({
    targetPhraseId: null,
    targetFingerprint: null,
  })
  mocks.prisma.batch.findUnique.mockResolvedValue({
    id: 'batch-1',
    creatorId: 1,
    status: 'Draft',
    contentVersion: 3,
  })
  mocks.prisma.pullRequest.findUnique.mockResolvedValue({
    id: 10,
    userId: 1,
    phraseId: null,
    dependedBy: [],
    batch: {
      id: 'batch-1',
      creatorId: 1,
      status: 'Draft',
      contentVersion: 3,
    },
  })
  mocks.prisma.$transaction.mockImplementation(async (callback) => callback(mocks.tx))
  mocks.tx.batch.updateMany.mockResolvedValue({ count: 1 })
  mocks.tx.pullRequest.create.mockResolvedValue({ id: 10 })
})

describe('web pull-request producer content versions', () => {
  it('rejects an old single-create client that omits the batch version', async () => {
    const { POST } = await import('./route')
    const response = await POST(jsonRequest('http://localhost/api/pull-requests', 'POST', {
      ...validItem,
      batchId: 'batch-1',
    }))

    expect(response.status).toBe(409)
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('claims and returns the next version for an existing-batch create', async () => {
    const { POST } = await import('./route')
    const response = await POST(jsonRequest('http://localhost/api/pull-requests', 'POST', {
      ...validItem,
      batchId: 'batch-1',
      expectedContentVersion: 3,
    }))

    expect(response.status).toBe(200)
    expect(mocks.tx.batch.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'batch-1', creatorId: 1, contentVersion: 3 }),
    }))
    await expect(response.json()).resolves.toMatchObject({ contentVersion: 4 })
  })

  it('rejects old PATCH and DELETE clients before mutating content', async () => {
    const detail = await import('./[id]/route')
    const patchResponse = await detail.PATCH(
      jsonRequest('http://localhost/api/pull-requests/10', 'PATCH', validItem),
      { params: Promise.resolve({ id: '10' }) },
    )
    const deleteResponse = await detail.DELETE(
      jsonRequest('http://localhost/api/pull-requests/10', 'DELETE', {}),
      { params: Promise.resolve({ id: '10' }) },
    )

    expect(patchResponse.status).toBe(409)
    expect(deleteResponse.status).toBe(409)
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })
})
