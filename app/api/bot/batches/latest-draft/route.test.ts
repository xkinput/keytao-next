import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mockRequireVerifiedBotUser = vi.fn()
const mockFindFirst = vi.fn()
const mockCreate = vi.fn()

vi.mock('@/lib/botUserAuth', () => ({ requireVerifiedBotUser: mockRequireVerifiedBotUser }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    batch: { findFirst: mockFindFirst, create: mockCreate },
  },
}))

function batchRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'batch-old',
    description: '键道助手草稿批次',
    createAt: new Date('2026-08-01T00:00:00.000Z'),
    contentVersion: 3,
    _count: { pullRequests: 1 },
    ...overrides,
  }
}

function get() {
  return new NextRequest('http://localhost/api/bot/batches/latest-draft?platform=qq&platformId=u-1')
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireVerifiedBotUser.mockResolvedValue({ authorized: true, user: { id: 42 } })
  mockFindFirst.mockResolvedValue(null)
})

describe('GET /api/bot/batches/latest-draft is read-only', () => {
  it('reports "no draft" instead of creating one', async () => {
    const { GET } = await import('./route')
    const res = await GET(get())

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      success: true,
      batchId: null,
      exists: false,
      pullRequestCount: 0,
      // CAS baseline a first write must present together with no batchId.
      contentVersion: 0,
      isNew: false,
    })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('returns the draft that holds content even when an empty draft is newer', async () => {
    // The incident shape: an empty batch was created after the one that owns
    // the items, so plain `createAt desc` would hand back the empty one.
    mockFindFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
      if (where.pullRequests) {
        return batchRow({ id: 'batch-785e0368', _count: { pullRequests: 1 } })
      }
      return batchRow({
        id: 'batch-ec511ac6',
        createAt: new Date('2026-08-04T00:00:00.000Z'),
        _count: { pullRequests: 0 },
      })
    })

    const { GET } = await import('./route')
    const res = await GET(get())

    expect(await res.json()).toMatchObject({
      success: true,
      batchId: 'batch-785e0368',
      exists: true,
      pullRequestCount: 1,
      contentVersion: 3,
    })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('falls back to the newest draft when none of them hold content', async () => {
    mockFindFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
      if (where.pullRequests) return null
      return batchRow({ id: 'batch-empty', _count: { pullRequests: 0 } })
    })

    const { GET } = await import('./route')
    const res = await GET(get())

    expect(await res.json()).toMatchObject({
      success: true,
      batchId: 'batch-empty',
      exists: true,
      pullRequestCount: 0,
    })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('does not touch the database when the caller is not authorized', async () => {
    mockRequireVerifiedBotUser.mockResolvedValue({ authorized: false, status: 401, message: '未授权' })

    const { GET } = await import('./route')
    const res = await GET(get())

    expect(res.status).toBe(401)
    expect(mockFindFirst).not.toHaveBeenCalled()
    expect(mockCreate).not.toHaveBeenCalled()
  })
})
