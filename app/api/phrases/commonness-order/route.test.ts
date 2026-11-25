import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'
import type { CommonnessOrderChain } from '@/lib/types/commonnessOrder'

const { getSession, checkRateLimit, upstream, findMany } = vi.hoisted(() => ({
  getSession: vi.fn(),
  checkRateLimit: vi.fn(),
  upstream: vi.fn(),
  findMany: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ getSession }))
vi.mock('@/lib/rateLimit', () => ({ checkRateLimit }))
vi.mock('@/lib/prisma', () => ({ prisma: { phrase: { findMany } } }))

const code = 'abcd'
const type = 'Phrase'
const chain: CommonnessOrderChain = {
  code, type, entries: [
    { word: '在用', weight: 110, source: 'current' },
    { word: '草稿', weight: null, source: 'draft', prId: 42 },
  ],
}
const chains = [chain]
const ordered = { code, type, status: 'reorder', orderedWords: ['草稿', '在用'] }
const words = { '草稿': { daily: '日常高频', authority: '离线词典已收录' } }

function request(body: unknown = { chains }) {
  return new NextRequest('http://localhost/api/phrases/commonness-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  getSession.mockResolvedValue({ id: 12 })
  checkRateLimit.mockReturnValue({ allowed: true, retryAfterMs: 0 })
  findMany.mockResolvedValue([])
  vi.stubEnv('BOT_API_URL', 'http://bot.test///')
  vi.stubEnv('BOT_API_KEY', 'unit-test-key')
  vi.stubGlobal('fetch', upstream)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('commonness-order proxy', () => {
  it('rejects unauthenticated and rate-limited requests before fetch', async () => {
    getSession.mockResolvedValueOnce(null)
    expect((await POST(request())).status).toBe(401)
    expect(checkRateLimit).not.toHaveBeenCalled()
    checkRateLimit.mockReturnValueOnce({ allowed: false, retryAfterMs: 440 })
    const limited = await POST(request())
    expect(limited.status).toBe(429)
    expect(limited.headers.get('Retry-After')).toBe('1')
    expect(checkRateLimit).toHaveBeenCalledWith('commonness-order:12')
    expect(upstream).not.toHaveBeenCalled()
  })

  it('forwards the draft chain with bot auth and a 15-second timeout and returns only response fields', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    upstream.mockResolvedValueOnce(Response.json({
      success: true, chains: [{ ...ordered, evidence: ['internal'] }], words,
    }))
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ chains: [ordered], words, reservedWeights: { 'abcd|Phrase': [] } })
    expect(timeout).toHaveBeenCalledWith(15_000)
    expect(upstream).toHaveBeenCalledWith('http://bot.test/api/keytao/commonness-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer unit-test-key' },
      body: JSON.stringify({ chains }),
      redirect: 'error',
      signal: timeout.mock.results[0].value,
    })
  })

  it('returns weights across all statuses in a single query grouped by code and type', async () => {
    const other = { code, type: 'Supplement' } as const
    findMany.mockResolvedValueOnce([{ code, type, weight: 110 }, { code, type, weight: 101 }])
    upstream.mockResolvedValueOnce(Response.json({
      chains: [ordered, { ...ordered, ...other }], words, reservedWeights: { 'abcd|Phrase': [999] },
    }))

    const response = await POST(request({ chains: [chain, { ...chain, ...other }] }))
    expect(response.status).toBe(200)
    expect((await response.json()).reservedWeights).toEqual({ 'abcd|Phrase': [110, 101], 'abcd|Supplement': [] })
    expect(findMany).toHaveBeenCalledExactlyOnceWith({
      where: { OR: [{ code, type }, other] },
      select: { code: true, type: true, weight: true },
    })
  })

  it.each([
    null,
    { chains: [] },
    { chains: Array(21).fill(chain) },
    { chains: [{ ...chain, entries: [chain.entries[0]] }] },
    { chains: [{ ...chain, entries: [chain.entries[0], chain.entries[0]] }] },
    { chains: [{ ...chain, entries: [chain.entries[0], { ...chain.entries[1], weight: '100' }] }] },
    { chains: [{ ...chain, entries: [chain.entries[0], { ...chain.entries[1], source: 'unknown' }] }] },
    { chains: [{ ...chain, entries: [chain.entries[0], { ...chain.entries[1], word: '有\n换行' }] }] },
    { chains: [{ ...chain, entries: Array.from({ length: 9 }, (_, i) => ({ ...chain.entries[0], word: String(i) })) }] },
    { chains: Array.from({ length: 16 }, (_, index) => ({
      ...chain,
      entries: Array.from({ length: 8 }, (_, i) => ({ ...chain.entries[0], word: `词${index}-${i}` })),
    })) },
  ])('rejects invalid request body %#', async body => {
    expect((await POST(request(body))).status).toBe(400)
    expect(upstream).not.toHaveBeenCalled()
    expect(findMany).not.toHaveBeenCalled()
  })

  it.each(['keep', 'ask'])('returns a valid %s result', async status => {
    const other = { ...ordered, status, orderedWords: ['在用', '草稿'] }
    upstream.mockResolvedValueOnce(Response.json({ success: true, chains: [other], words: {} }))
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ chains: [other], words: {}, reservedWeights: { 'abcd|Phrase': [] } })
  })

  it.each([
    { chains: [], words },
    { chains: [{ ...ordered, status: 'unknown' }], words },
    { chains: [{ ...ordered, type: 'Single' }], words },
    { chains: [{ ...ordered, orderedWords: ['草稿', '外来'] }], words },
    { chains: [{ ...ordered, orderedWords: ['草稿', '草稿'] }], words },
    { chains: [ordered], words: { '草稿': { daily: 3 } } },
    { chains: [ordered], words: { '外来': { daily: '日常高频' } } },
  ])('rejects invalid upstream response %#', async body => {
    upstream.mockResolvedValueOnce(Response.json(body))
    expect((await POST(request())).status).toBe(502)
  })

  it('does not forward drafts without a configured bot key', async () => {
    vi.stubEnv('BOT_API_KEY', undefined)
    expect((await POST(request())).status).toBe(503)
    expect(upstream).not.toHaveBeenCalled()
  })

  it('reports a timeout when the response fails after its deadline', async () => {
    const signal = AbortSignal.abort()
    vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(signal)
    upstream.mockRejectedValueOnce(signal.reason)
    expect((await POST(request())).status).toBe(504)
  })
})
