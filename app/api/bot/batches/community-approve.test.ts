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
    user: { findFirst: vi.fn() },
  },
}))

const { prisma } = await import('@/lib/prisma')
const { BatchConcurrentUpdateError } = await import('@/lib/services/batchApprovalService')
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockPrisma = prisma as any

const CREATOR = {
  id: 7,
  name: '创建者',
  nickname: '创建者',
  roles: [{ value: 'R:NORMAL' }],
}

const VOTERS = [
  { platform: 'qq', platformId: '100' },
  { platform: 'telegram', platformId: '200' },
  { platform: 'qq', platformId: '300' },
]

const BOUND_USERS = [
  { id: 10, name: '用户甲', nickname: '投票者甲', roles: [] },
  { id: 11, name: '投票者乙', nickname: null, roles: [] },
  { id: 12, name: null, nickname: null, roles: [] },
]

function payload(overrides: Record<string, unknown> = {}) {
  return {
    platform: 'qq',
    platformId: '123',
    voters: VOTERS,
    expectedContentVersion: 0,
    ...overrides,
  }
}

function communityApproveRequest(body: unknown = payload()) {
  return new NextRequest('http://localhost/api/bot/batches/batch-1/community-approve', {
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
    creatorId: CREATOR.id,
    status: 'Submitted',
    contentVersion: 0,
    pullRequests,
    ...overrides,
  }
}

async function callCommunityApprove(body?: unknown, request = communityApproveRequest(body)) {
  const { POST } = await import('./[id]/community-approve/route')
  return POST(request, { params: Promise.resolve({ id: 'batch-1' }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireVerifiedBotUser.mockResolvedValue({ authorized: true, user: CREATOR, platform: 'qq' })
  mockApproveSubmittedBatch.mockResolvedValue({ batch: { id: 'batch-1', status: 'Approved' } })
  mockPrisma.batch.findUnique.mockResolvedValue(batchWith([pr()]))
  mockPrisma.user.findFirst.mockImplementation(({ where }: { where: { qqId?: string, telegramId?: string } }) => {
    const index = VOTERS.findIndex(voter => voter.platformId === (where.qqId ?? where.telegramId))
    return Promise.resolve(BOUND_USERS[index] ?? null)
  })
})

describe('POST /api/bot/batches/:id/community-approve', () => {
  it('approves manual-review items with three bound voters and records their display names', async () => {
    mockPrisma.batch.findUnique.mockResolvedValue(batchWith([
      pr(),
      pr({ word: '存疑词', code: 'cyci', needsManualReview: true }),
    ]))

    const res = await callCommunityApprove()

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      success: true,
      message: '批次已由群友投票审核通过',
      batch: { id: 'batch-1', status: 'Approved' },
      voters: ['投票者甲', '投票者乙', '12'],
    })
    expect(mockApproveSubmittedBatch).toHaveBeenCalledExactlyOnceWith({
      batchId: 'batch-1',
      reviewNote: '群友投票通过：投票者甲、投票者乙、12',
      mode: 'community-vote',
      allowDelete: false,
      expectedContentVersion: 0,
      reviewerId: CREATOR.id,
    })
    for (const where of [
      { qqId: '100', status: 'ENABLE' },
      { telegramId: '200', status: 'ENABLE' },
      { qqId: '300', status: 'ENABLE' },
    ]) {
      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
        where,
        select: {
          id: true,
          name: true,
          nickname: true,
          roles: { select: { value: true } },
        },
      })
    }
  })

  it('passes the signed raw body to creator authentication', async () => {
    const body = payload()
    const request = communityApproveRequest(body)

    const res = await callCommunityApprove(body, request)

    expect(res.status).toBe(200)
    expect(mockRequireVerifiedBotUser).toHaveBeenCalledExactlyOnceWith('qq', '123', {
      request,
      rawBody: JSON.stringify(body),
    })
  })

  it('refuses a creator among the resolved voter users', async () => {
    mockPrisma.user.findFirst.mockResolvedValueOnce(CREATOR)

    const res = await callCommunityApprove()

    expect(res.status).toBe(400)
    expect(mockApproveSubmittedBatch).not.toHaveBeenCalled()
  })

  it('refuses a repeated voter identity', async () => {
    const res = await callCommunityApprove(payload({ voters: [VOTERS[0], VOTERS[0], VOTERS[2]] }))

    expect(res.status).toBe(400)
    expect(mockApproveSubmittedBatch).not.toHaveBeenCalled()
  })

  it('refuses distinct platform identities bound to the same user', async () => {
    mockPrisma.user.findFirst.mockResolvedValueOnce(BOUND_USERS[0])
      .mockResolvedValueOnce(BOUND_USERS[0])
      .mockResolvedValueOnce(BOUND_USERS[2])

    const res = await callCommunityApprove()

    expect(res.status).toBe(400)
    expect(mockApproveSubmittedBatch).not.toHaveBeenCalled()
  })

  it('reports every unbound voter by identity and does not approve', async () => {
    mockPrisma.user.findFirst.mockResolvedValueOnce(null)
      .mockResolvedValueOnce(BOUND_USERS[1])
      .mockResolvedValueOnce(null)

    const res = await callCommunityApprove()

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ success: false, unboundVoters: [VOTERS[0], VOTERS[2]] })
    expect(mockApproveSubmittedBatch).not.toHaveBeenCalled()
  })

  it('refuses bare deletes even when they also require manual review', async () => {
    mockPrisma.batch.findUnique.mockResolvedValue(batchWith([
      pr({ action: 'Delete', word: '删词', code: 'shci', needsManualReview: true }),
    ]))

    const res = await callCommunityApprove()

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({
      success: false,
      message: '含纯删除项的批次不能投票通过，已保留给管理员审核',
    })
    expect(mockApproveSubmittedBatch).not.toHaveBeenCalled()
  })

  it('refuses a batch owned by another user', async () => {
    mockPrisma.batch.findUnique.mockResolvedValue(batchWith([pr()], { creatorId: 99 }))

    const res = await callCommunityApprove()

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ message: '无权限操作此批次' })
    expect(mockApproveSubmittedBatch).not.toHaveBeenCalled()
  })

  it('refuses a missing batch', async () => {
    mockPrisma.batch.findUnique.mockResolvedValue(null)

    const res = await callCommunityApprove()

    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ message: '批次不存在' })
    expect(mockApproveSubmittedBatch).not.toHaveBeenCalled()
  })

  it('refuses a batch that is not submitted', async () => {
    mockPrisma.batch.findUnique.mockResolvedValue(batchWith([pr()], { status: 'Draft' }))

    const res = await callCommunityApprove()

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ message: '只能自动批准已提交审核的批次' })
    expect(mockApproveSubmittedBatch).not.toHaveBeenCalled()
  })

  it('refuses a stale content version', async () => {
    mockPrisma.batch.findUnique.mockResolvedValue(batchWith([pr()], { contentVersion: 1 }))

    const res = await callCommunityApprove()

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ message: '批次内容已被修改，请刷新后重试' })
    expect(mockApproveSubmittedBatch).not.toHaveBeenCalled()
  })

  it('preserves a concurrent-update conflict from the approval helper', async () => {
    mockApproveSubmittedBatch.mockRejectedValueOnce(new BatchConcurrentUpdateError())

    const res = await callCommunityApprove()

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ success: false })
  })

  it('returns creator authentication failure before any binding lookup', async () => {
    mockRequireVerifiedBotUser.mockResolvedValue({ authorized: false, message: '签名无效', status: 401 })

    const res = await callCommunityApprove()

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ success: false, message: '签名无效' })
    expect(mockPrisma.batch.findUnique).not.toHaveBeenCalled()
    expect(mockPrisma.user.findFirst).not.toHaveBeenCalled()
    expect(mockApproveSubmittedBatch).not.toHaveBeenCalled()
  })

  it('rejects malformed JSON before authentication', async () => {
    const request = new NextRequest('http://localhost/api/bot/batches/batch-1/community-approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    })

    const res = await callCommunityApprove(undefined, request)

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ success: false, message: '请求格式错误' })
    expect(mockRequireVerifiedBotUser).not.toHaveBeenCalled()
    expect(mockApproveSubmittedBatch).not.toHaveBeenCalled()
  })

  it.each([
    ['null body', null],
    ['array body', []],
    ['unsupported top-level field', payload({ reviewNote: 'caller-controlled note' })],
    ['missing voters', payload({ voters: undefined })],
    ['two voters', payload({ voters: VOTERS.slice(0, 2) })],
    ['twenty-one voters', payload({ voters: Array.from({ length: 21 }, (_, i) => ({ platform: 'qq', platformId: String(i) })) })],
    ['non-object voter', payload({ voters: [VOTERS[0], VOTERS[1], null] })],
    ['caller-supplied voter user id', payload({ voters: [VOTERS[0], VOTERS[1], { ...VOTERS[2], userId: 12 }] })],
    ['web voter', payload({ voters: [VOTERS[0], VOTERS[1], { platform: 'web', platformId: '12' }] })],
    ['unknown voter platform', payload({ voters: [VOTERS[0], VOTERS[1], { platform: 'discord', platformId: '300' }] })],
    ['blank voter identity', payload({ voters: [VOTERS[0], VOTERS[1], { platform: 'qq', platformId: '  ' }] })],
    ['missing content version', payload({ expectedContentVersion: undefined })],
    ['negative content version', payload({ expectedContentVersion: -1 })],
    ['fractional content version', payload({ expectedContentVersion: 0.5 })],
  ])('rejects %s before authentication', async (_name, body) => {
    const res = await callCommunityApprove(body)

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ success: false })
    expect(mockRequireVerifiedBotUser).not.toHaveBeenCalled()
    expect(mockPrisma.user.findFirst).not.toHaveBeenCalled()
    expect(mockApproveSubmittedBatch).not.toHaveBeenCalled()
  })
})
