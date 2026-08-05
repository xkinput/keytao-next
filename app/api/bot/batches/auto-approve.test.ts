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

const NORMAL_USER = {
  id: 8,
  name: '普通用户',
  nickname: '普通用户',
  roles: [{ value: 'R:NORMAL' }],
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

function batchWith(
  pullRequests: ReturnType<typeof pr>[],
  overrides: Record<string, unknown> = {},
) {
  return {
    id: 'batch-1',
    creatorId: BOT_USER.id,
    status: 'Submitted',
    contentVersion: 0,
    pullRequests,
    ...overrides,
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
  it('keeps auto-approval working for the machine account', async () => {
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

  it('allows a non-R:BOT user to auto-approve their own clean batch', async () => {
    mockRequireVerifiedBotUser.mockResolvedValue({
      authorized: true,
      user: NORMAL_USER,
      platform: 'qq',
    })
    mockPrisma.batch.findUnique.mockResolvedValue(batchWith([pr()], {
      creatorId: NORMAL_USER.id,
    }))

    const res = await callAutoApprove()

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      success: true,
      message: '批次已由本喵自动审核通过',
    })
    expect(mockApproveSubmittedBatch).toHaveBeenCalledWith(
      expect.objectContaining({ reviewerId: NORMAL_USER.id })
    )
  })

  it('still refuses a batch owned by another user', async () => {
    mockRequireVerifiedBotUser.mockResolvedValue({
      authorized: true,
      user: NORMAL_USER,
      platform: 'qq',
    })
    mockPrisma.batch.findUnique.mockResolvedValue(batchWith([pr()]))

    const res = await callAutoApprove()

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ message: '无权限操作此批次' })
    expect(mockPrisma.batch.findUnique).toHaveBeenCalledOnce()
    expect(mockApproveSubmittedBatch).not.toHaveBeenCalled()
  })

  it('still refuses a batch that is not submitted', async () => {
    mockPrisma.batch.findUnique.mockResolvedValue(batchWith([pr()], { status: 'Draft' }))

    const res = await callAutoApprove()

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ message: '只能自动批准已提交审核的批次' })
    expect(mockApproveSubmittedBatch).not.toHaveBeenCalled()
  })

  it('still refuses a stale content version', async () => {
    mockPrisma.batch.findUnique.mockResolvedValue(batchWith([pr()], { contentVersion: 1 }))

    const res = await callAutoApprove()

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ message: '批次内容已被修改，请刷新后重试' })
    expect(mockApproveSubmittedBatch).not.toHaveBeenCalled()
  })

  it('still refuses bare deletes', async () => {
    mockPrisma.batch.findUnique.mockResolvedValue(batchWith([
      pr({ action: 'Delete', word: '删词', code: 'shci' }),
    ]))

    const res = await callAutoApprove()

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({
      message: '自动审核禁止纯删除项，已保留给管理员审核',
    })
    expect(mockApproveSubmittedBatch).not.toHaveBeenCalled()
  })
})
