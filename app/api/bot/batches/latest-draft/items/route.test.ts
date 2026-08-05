import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mockRequireVerifiedBotUser = vi.fn()
const mockFindFirst = vi.fn()

const LEGACY_MANUAL_REVIEW_MARKERS = [
  '自动审核：该词需管理员审核',
  '自动审核:该词需管理员审核',
  '自动审核：该词需要管理员审核',
  '自动审核:该词需要管理员审核',
  '自动审核：预计需管理员审核',
  '自动审核:预计需管理员审核',
  '自动审核：预计需要管理员审核',
  '自动审核:预计需要管理员审核',
  '自动审核：需管理员审核',
  '自动审核:需管理员审核',
  '自动审核：该词暂未完成预审',
  '自动审核:该词暂未完成预审',
] as const

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

function storedItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1, action: 'Create', word: '存疑词', oldWord: null, code: 'cyci', type: 'Phrase',
    remark: null, weight: null, status: 'Pending', createAt: new Date(), conflictReason: null,
    needsManualReview: false, ...overrides,
  }
}

async function readStoredItems(storedItems: Array<Record<string, unknown>>) {
  mockFindFirst.mockImplementationOnce(async ({ select }: {
    select: { pullRequests: { select: Record<string, boolean> } }
  }) => ({
    id: 'batch-2', description: '键道助手草稿批次', createAt: new Date(), contentVersion: 9,
    pullRequests: storedItems.map(item => Object.fromEntries(
      Object.keys(select.pullRequests.select).map(key => [key, item[key]])
    )),
  }))

  const { GET } = await import('./route')
  const res = await GET(new NextRequest(
    'http://localhost/api/bot/batches/latest-draft/items?platform=qq&platformId=u-1&batchId=batch-2'
  ))
  return { res, body: await res.json() }
}

describe('latest draft item snapshot', () => {
  it.each(LEGACY_MANUAL_REVIEW_MARKERS)(
    'returns effective true for stored false with legacy marker %s',
    async marker => {
      const { res, body } = await readStoredItems([
        storedItem({ remark: `用户备注；${marker}（证据不足）` }),
      ])

      expect(res.status).toBe(200)
      expect(body.items[0].needsManualReview).toBe(true)
    },
  )

  it('keeps stored false when the remark has no legacy marker', async () => {
    const { res, body } = await readStoredItems([
      storedItem({ remark: '喵喵审词：读音 chang jian；自动审核：该词可自动通过' }),
    ])

    expect(res.status).toBe(200)
    expect(body.items[0].needsManualReview).toBe(false)
  })

  it('keeps stored true for Create, Change, and Delete regardless of remark content', async () => {
    const { res, body } = await readStoredItems([
      storedItem({ id: 1, action: 'Create', remark: null, needsManualReview: true }),
      storedItem({ id: 2, action: 'Change', remark: '无人工审核标记', needsManualReview: true }),
      storedItem({ id: 3, action: 'Delete', remark: '自动审核：该词可自动通过', needsManualReview: true }),
    ])

    expect(res.status).toBe(200)
    expect(body.items.map((item: { needsManualReview: boolean }) => item.needsManualReview))
      .toEqual([true, true, true])
    expect(mockFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        pullRequests: expect.objectContaining({
          select: expect.objectContaining({ needsManualReview: true }),
        }),
      }),
    }))
  })

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
