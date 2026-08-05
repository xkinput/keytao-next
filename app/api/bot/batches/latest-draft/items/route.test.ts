import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mockRequireVerifiedBotUser = vi.fn()
const mockFindFirst = vi.fn()

vi.mock('@/lib/botUserAuth', () => ({ requireVerifiedBotUser: mockRequireVerifiedBotUser }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    batch: { findFirst: mockFindFirst },
  },
}))
vi.mock('@/lib/services/batchConflictService', () => ({ checkBatchConflictsWithWeight: vi.fn(async () => []) }))

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireVerifiedBotUser.mockResolvedValue({ authorized: true, user: { id: 42 } })
  mockFindFirst.mockResolvedValue({
    id: 'batch-2', description: '键道助手草稿批次', createAt: new Date(),
    contentVersion: 9, pullRequests: [],
  })
})

describe('latest draft item snapshot', () => {
  it('optionally pins the query to an owned batch id and returns its content version', async () => {
    const { GET } = await import('./route')
    const res = await GET(new NextRequest(
      'http://localhost/api/bot/batches/latest-draft/items?platform=qq&platformId=u-1&batchId=batch-2'
    ))

    expect(res.status).toBe(200)
    expect(mockFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'batch-2', creatorId: 42 }),
    }))
    expect(await res.json()).toMatchObject({ batchId: 'batch-2', contentVersion: 9 })
  })

  it('resolves the batch through the shared current-draft selector when no id is pinned', async () => {
    // First lookup = "a draft that holds content", which is what the shared
    // selector asks for before falling back to the newest draft.
    mockFindFirst
      .mockResolvedValueOnce({ id: 'batch-with-items', contentVersion: 4, _count: { pullRequests: 2 }, description: '键道助手草稿批次', createAt: new Date() })
      .mockResolvedValueOnce({ id: 'batch-with-items', description: '键道助手草稿批次', createAt: new Date(), contentVersion: 4, pullRequests: [] })

    const { GET } = await import('./route')
    const res = await GET(new NextRequest(
      'http://localhost/api/bot/batches/latest-draft/items?platform=qq&platformId=u-1'
    ))

    expect(res.status).toBe(200)
    expect(mockFindFirst).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({ creatorId: 42, pullRequests: { some: {} } }),
    }))
    expect(mockFindFirst).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({ id: 'batch-with-items', creatorId: 42, status: 'Draft' }),
    }))
    expect(await res.json()).toMatchObject({ batchId: 'batch-with-items', contentVersion: 4 })
  })

  it('reports an empty draft without inventing a batch', async () => {
    mockFindFirst.mockResolvedValue(null)

    const { GET } = await import('./route')
    const res = await GET(new NextRequest(
      'http://localhost/api/bot/batches/latest-draft/items?platform=qq&platformId=u-1'
    ))

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true, batchId: null, items: [], message: '当前没有草稿批次' })
  })

  it('disables the legacy direct-write endpoint', async () => {
    const { POST } = await import('./route')
    const res = await POST(new NextRequest(
      'http://localhost/api/bot/batches/latest-draft/items',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: 'qq', platformId: 'u-1', word: '测试', code: 'ces',
        }),
      }
    ))

    expect(res.status).toBe(410)
    expect(mockRequireVerifiedBotUser).not.toHaveBeenCalled()
    expect(mockFindFirst).not.toHaveBeenCalled()
  })
})
