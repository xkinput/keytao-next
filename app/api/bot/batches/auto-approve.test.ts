import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockRequireVerifiedBotUser = vi.fn()
const mockApproveSubmittedBatch = vi.fn()

vi.mock('@/lib/botUserAuth', () => ({
  requireVerifiedBotUser: mockRequireVerifiedBotUser,
}))

vi.mock('@/lib/services/batchApprovalService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/batchApprovalService')>()
  return { ...actual, approveSubmittedBatch: mockApproveSubmittedBatch }
})

vi.mock('@/lib/prisma', () => ({
  prisma: {
    batch: { findUnique: vi.fn() },
  },
}))

const { prisma } = await import('@/lib/prisma')
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockPrisma = prisma as any

const BOT_USER = {
  id: 7,
  name: '喵喵Bot',
  nickname: '喵喵Bot',
  roles: [{ value: 'R:NORMAL' }, { value: 'R:BOT' }],
}

function autoApproveRequest(body: unknown = {
  platform: 'qq',
  platformId: '123',
  expectedContentVersion: 0,
}) {
  return new NextRequest('http://localhost/api/bot/batches/batch-1/auto-approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function pr(overrides: Record<string, unknown> = {}) {
  return { action: 'Create', word: '测试', code: 'ces', needsManualReview: false, ...overrides }
}

function batchWith(pullRequests: ReturnType<typeof pr>[]) {
  return {
    id: 'batch-1',
    creatorId: BOT_USER.id,
    status: 'Submitted',
    contentVersion: 0,
    pullRequests,
  }
}

async function callAutoApprove(body?: unknown) {
  const { POST } = await import('./[id]/auto-approve/route')
  return POST(autoApproveRequest(body), { params: Promise.resolve({ id: 'batch-1' }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireVerifiedBotUser.mockResolvedValue({ authorized: true, user: BOT_USER, platform: 'qq' })
  mockApproveSubmittedBatch.mockResolvedValue({ batch: { id: 'batch-1', status: 'Approved' } })
})

describe('POST /api/bot/batches/:id/auto-approve', () => {
  it('approves a clean batch', async () => {
    mockPrisma.batch.findUnique.mockResolvedValue(batchWith([pr()]))

    const res = await callAutoApprove()

    expect(res.status).toBe(200)
    expect(mockApproveSubmittedBatch).toHaveBeenCalledWith(
      expect.objectContaining({ batchId: 'batch-1', mode: 'bot-auto', reviewerId: BOT_USER.id })
    )
  })

  it('refuses the batch when any entry is flagged for manual review', async () => {
    mockPrisma.batch.findUnique.mockResolvedValue(batchWith([
      pr(),
      pr({ word: '存疑词', code: 'cyci', needsManualReview: true }),
    ]))

    const res = await callAutoApprove()
    const body = await res.json()

    expect(res.status).toBe(422)
    expect(body.success).toBe(false)
    expect(body.message).toContain('存疑词')
    expect(body.message).toContain('cyci')
    expect(body.needsManualReview).toEqual([{ word: '存疑词', code: 'cyci' }])
    // The decisive assertion: nothing was approved.
    expect(mockApproveSubmittedBatch).not.toHaveBeenCalled()
  })

  it('lists every flagged entry, truncating the message past five', async () => {
    mockPrisma.batch.findUnique.mockResolvedValue(batchWith(
      Array.from({ length: 7 }, (_, i) =>
        pr({ word: `词${i}`, code: `cd${i}`, needsManualReview: true })
      )
    ))

    const res = await callAutoApprove()
    const body = await res.json()

    expect(res.status).toBe(422)
    expect(body.needsManualReview).toHaveLength(7)
    expect(body.message).toContain('等 7 条')
    expect(mockApproveSubmittedBatch).not.toHaveBeenCalled()
  })

  it('rejects an account without the R:BOT role before reading the batch', async () => {
    mockRequireVerifiedBotUser.mockResolvedValue({
      authorized: true,
      user: { ...BOT_USER, roles: [{ value: 'R:NORMAL' }] },
      platform: 'qq',
    })

    const res = await callAutoApprove()

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ message: '当前账号无自动审核权限' })
    expect(mockPrisma.batch.findUnique).not.toHaveBeenCalled()
    expect(mockApproveSubmittedBatch).not.toHaveBeenCalled()
  })

  it('still refuses bare deletes', async () => {
    mockPrisma.batch.findUnique.mockResolvedValue(batchWith([
      pr({ action: 'Delete', word: '删词', code: 'shci' }),
    ]))

    const res = await callAutoApprove()

    expect(res.status).toBe(400)
    expect(mockApproveSubmittedBatch).not.toHaveBeenCalled()
  })
})
