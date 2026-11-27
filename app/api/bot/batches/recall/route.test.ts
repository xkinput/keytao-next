import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mockRequireVerifiedBotUser = vi.fn()
const mockFindFirst = vi.fn()
const mockUpdateMany = vi.fn()
const mockPrFindFirst = vi.fn()
const mockPrUpdateMany = vi.fn()
const mockNoteFindFirst = vi.fn()
const mockNoteDeleteMany = vi.fn()
const mockExecuteRawUnsafe = vi.fn()

vi.mock('@/lib/botUserAuth', () => ({ requireVerifiedBotUser: mockRequireVerifiedBotUser }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    batch: { findFirst: mockFindFirst, updateMany: mockUpdateMany, deleteMany: vi.fn() },
    pullRequest: { findFirst: mockPrFindFirst, updateMany: mockPrUpdateMany },
    pullRequestReviewNote: { findFirst: mockNoteFindFirst, deleteMany: mockNoteDeleteMany },
    $transaction: vi.fn(async (callback) => callback({
      batch: { findFirst: mockFindFirst, updateMany: mockUpdateMany },
      pullRequest: { findFirst: mockPrFindFirst, updateMany: mockPrUpdateMany },
      pullRequestReviewNote: { findFirst: mockNoteFindFirst, deleteMany: mockNoteDeleteMany },
      $executeRawUnsafe: mockExecuteRawUnsafe,
    })),
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireVerifiedBotUser.mockResolvedValue({ authorized: true, user: { id: 42 } })
  mockFindFirst.mockResolvedValue({
    id: 'submitted-1', status: 'Submitted', contentVersion: 6, itemReviewStarted: false,
    reviewerId: null, reviewedAt: null, syncTaskId: null,
    description: '键道助手', _count: { pullRequests: 2 },
  })
  mockUpdateMany.mockResolvedValue({ count: 1 })
  mockPrFindFirst.mockResolvedValue(null)
  mockPrUpdateMany.mockResolvedValue({ count: 0 })
  mockNoteFindFirst.mockResolvedValue(null)
  mockNoteDeleteMany.mockResolvedValue({ count: 0 })
})

describe('bot batch recall snapshot', () => {
  it('GET resolves the exact latest submitted target without changing it', async () => {
    const { GET } = await import('./route')
    const res = await GET(new NextRequest(
      'http://localhost/api/bot/batches/recall?platform=qq&platformId=u-1'
    ))

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      batchId: 'submitted-1', contentVersion: 6, status: 'Submitted', pullRequestCount: 2,
    })
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })

  it('POST requires and CAS-binds the exact batch snapshot', async () => {
    mockFindFirst
      .mockResolvedValueOnce({
        id: 'submitted-1', status: 'Submitted', contentVersion: 6,
        description: '键道助手', _count: { pullRequests: 2 },
      })
      .mockResolvedValueOnce(null)
    mockUpdateMany.mockResolvedValue({ count: 0 })
    const { POST } = await import('./route')
    const res = await POST(new NextRequest('http://localhost/api/bot/batches/recall', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: 'qq', platformId: 'u-1', batchId: 'submitted-1', expectedContentVersion: 6,
      }),
    }))

    expect(res.status).toBe(409)
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: 'submitted-1', creatorId: 42, status: 'Submitted', contentVersion: 6, itemReviewStarted: false },
      data: { status: 'Draft', contentVersion: { increment: 1 } },
    })
  })

  it('returns the advanced version so a status round trip cannot revive old tickets', async () => {
    mockFindFirst
      .mockResolvedValueOnce({
        id: 'submitted-1', status: 'Submitted', contentVersion: 6,
        description: '键道助手', _count: { pullRequests: 2 },
      })
      .mockResolvedValueOnce(null)
    const { POST } = await import('./route')
    const res = await POST(new NextRequest('http://localhost/api/bot/batches/recall', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: 'qq', platformId: 'u-1', batchId: 'submitted-1', expectedContentVersion: 6,
      }),
    }))

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      success: true,
      batchId: 'submitted-1',
      status: 'Draft',
      contentVersion: 7,
    })
  })

  it('allows recalling a bot-preapproved-only submitted batch and resets bot approvals back to Pending', async () => {
    const botPreapprovedBatch = {
      id: 'submitted-bot-preapproved',
      status: 'Submitted',
      contentVersion: 2,
      itemReviewStarted: true,
      reviewerId: null,
      reviewedAt: null,
      syncTaskId: null,
      description: '键道助手',
      _count: { pullRequests: 3 },
    }
    mockFindFirst.mockResolvedValueOnce(botPreapprovedBatch)
    const { GET, POST } = await import('./route')
    const previewRes = await GET(new NextRequest(
      'http://localhost/api/bot/batches/recall?platform=qq&platformId=u-1'
    ))
    expect(previewRes.status).toBe(200)
    expect(await previewRes.json()).toMatchObject({
      success: true,
      batchId: 'submitted-bot-preapproved',
      contentVersion: 2,
    })

    mockFindFirst
      .mockResolvedValueOnce(botPreapprovedBatch)
      .mockResolvedValueOnce(null)
    const recallRes = await POST(new NextRequest('http://localhost/api/bot/batches/recall', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: 'qq', platformId: 'u-1', batchId: 'submitted-bot-preapproved', expectedContentVersion: 2,
      }),
    }))
    expect(recallRes.status).toBe(200)
    expect(await recallRes.json()).toMatchObject({
      success: true,
      batchId: 'submitted-bot-preapproved',
      status: 'Draft',
      contentVersion: 3,
    })
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'submitted-bot-preapproved',
        creatorId: 42,
        status: 'Submitted',
        itemReviewStarted: true,
        reviewerId: null,
        reviewedAt: null,
        syncTaskId: null,
        contentVersion: 2,
      },
      data: { status: 'Draft', itemReviewStarted: false, contentVersion: { increment: 1 } },
    })
    expect(mockPrUpdateMany).toHaveBeenCalledWith({
      where: { batchId: 'submitted-bot-preapproved', status: 'Approved', appliedAt: null },
      data: { status: 'Pending' },
    })
    expect(mockNoteDeleteMany).toHaveBeenCalledWith({
      where: {
        pullRequest: { batchId: 'submitted-bot-preapproved' },
        reviewerId: null,
        decision: 'Approved',
        reason: '本喵根据逐条审核记录标记通过',
      },
    })
  })

  it('blocks GET and POST cleanly when a human reviewer has started item review', async () => {
    const humanReviewedBatch = {
      id: 'submitted-human-reviewed',
      status: 'Submitted',
      contentVersion: 3,
      itemReviewStarted: true,
      reviewerId: null,
      reviewedAt: null,
      syncTaskId: null,
      description: '键道助手',
      _count: { pullRequests: 2 },
    }
    mockNoteFindFirst.mockResolvedValue({ id: 99 })
    mockFindFirst.mockResolvedValueOnce(humanReviewedBatch)
    const { GET, POST } = await import('./route')

    const previewRes = await GET(new NextRequest(
      'http://localhost/api/bot/batches/recall?platform=qq&platformId=u-1'
    ))
    expect(previewRes.status).toBe(409)
    expect(await previewRes.json()).toMatchObject({
      success: false,
      batchId: 'submitted-human-reviewed',
      message: '最新提审批次已开始逐词审核，无法撤回',
    })

    mockFindFirst.mockResolvedValueOnce(humanReviewedBatch)
    const recallRes = await POST(new NextRequest('http://localhost/api/bot/batches/recall', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: 'qq', platformId: 'u-1', batchId: 'submitted-human-reviewed', expectedContentVersion: 3,
      }),
    }))
    expect(recallRes.status).toBe(409)
    expect(await recallRes.json()).toMatchObject({
      success: false,
      message: '批次已开始逐词审核，不能整批撤销',
    })
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })
})
