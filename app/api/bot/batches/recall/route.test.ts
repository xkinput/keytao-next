import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mockRequireVerifiedBotUser = vi.fn()
const mockFindFirst = vi.fn()
const mockUpdateMany = vi.fn()
const mockExecuteRawUnsafe = vi.fn()

vi.mock('@/lib/botUserAuth', () => ({ requireVerifiedBotUser: mockRequireVerifiedBotUser }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    batch: { findFirst: mockFindFirst, updateMany: mockUpdateMany, deleteMany: vi.fn() },
    $transaction: vi.fn(async (callback) => callback({
      batch: { findFirst: mockFindFirst, updateMany: mockUpdateMany },
      $executeRawUnsafe: mockExecuteRawUnsafe,
    })),
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireVerifiedBotUser.mockResolvedValue({ authorized: true, user: { id: 42 } })
  mockFindFirst.mockResolvedValue({
    id: 'submitted-1', status: 'Submitted', contentVersion: 6,
    description: '键道助手', _count: { pullRequests: 2 },
  })
  mockUpdateMany.mockResolvedValue({ count: 1 })
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
      where: { id: 'submitted-1', creatorId: 42, status: 'Submitted', contentVersion: 6 },
      data: { status: 'Draft' },
    })
  })
})
