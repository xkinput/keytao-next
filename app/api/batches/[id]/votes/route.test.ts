import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  transaction: vi.fn(),
  lock: vi.fn(),
  batch: vi.fn(),
  item: vi.fn(),
  update: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession: mocks.session }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: mocks.transaction,
    batch: { findUnique: mocks.batch },
  },
}))

import { GET, POST } from './route'

const url = 'http://localhost/api/batches/batch-1/votes'
const params = { params: Promise.resolve({ id: 'batch-1' }) }
const author = 7
const voter = 9
const itemId = 12

function item(vote: 'like' | 'dislike' | null) {
  return {
    id: itemId,
    status: 'Pending',
    userId: author,
    _count: { likedBy: vote === 'like' ? 3 : 2, dislikedBy: vote === 'dislike' ? 2 : 1 },
    likedBy: vote === 'like' ? [{ id: voter }] : [],
    dislikedBy: vote === 'dislike' ? [{ id: voter }] : [],
  }
}

function post(vote: unknown, target = itemId) {
  return POST(new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemId: target, vote }),
  }), params)
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.session.mockResolvedValue({ id: voter })
  mocks.batch.mockResolvedValue({ status: 'Submitted', creatorId: author, pullRequests: [item('like')] })
  mocks.item.mockResolvedValue(item('like'))
  mocks.transaction.mockImplementation(async callback => callback({
    $queryRaw: mocks.lock,
    batch: { findUnique: mocks.batch },
    pullRequest: { findFirst: mocks.item, update: mocks.update },
  }))
})

describe('web votes by batch item', () => {
  it('returns totals and the current account choice without voter identities', async () => {
    const response = await GET(new NextRequest(url), params)
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await response.json()).toEqual({
      votes: [{ itemId, likes: 3, dislikes: 1, vote: 'like', canVote: true }],
    })
    expect(mocks.batch.mock.calls[0][0].select.pullRequests.select.likedBy.where).toEqual({ id: voter })
  })

  it('validates the user and choice before starting a write transaction', async () => {
    mocks.session.mockResolvedValueOnce(null)
    expect((await post('like')).status).toBe(401)
    expect((await post('wrong')).status).toBe(400)
    expect((await post('like', 2147483648)).status).toBe(400)
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('rejects other-batch items, votes by the author and closed items', async () => {
    mocks.item.mockResolvedValueOnce(null)
    expect((await post('like')).status).toBe(404)
    expect(mocks.item).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: itemId, batchId: 'batch-1' },
    }))
    mocks.session.mockResolvedValueOnce({ id: author })
    expect((await post('like')).status).toBe(403)
    mocks.item.mockResolvedValueOnce({ ...item('like'), status: 'Rejected' })
    expect((await post('like')).status).toBe(409)
    mocks.batch.mockResolvedValueOnce({ status: 'Draft', creatorId: author })
    expect((await post('like')).status).toBe(409)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it.each([
    ['like', { likedBy: { connect: { id: voter } }, dislikedBy: { disconnect: { id: voter } } }],
    ['dislike', { likedBy: { disconnect: { id: voter } }, dislikedBy: { connect: { id: voter } } }],
    [null, { likedBy: { disconnect: { id: voter } }, dislikedBy: { disconnect: { id: voter } } }],
  ] as const)('serializes the vote %s and clears the opposite relationship', async (vote, data) => {
    mocks.update.mockResolvedValueOnce(item(vote))
    const response = await post(vote)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ vote: { itemId, vote, canVote: true } })
    expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(mocks.batch.mock.invocationCallOrder[0])
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      where: { id: itemId },
      data,
    }))
  })
})
