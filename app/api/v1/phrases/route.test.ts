import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/rateLimit', () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true, retryAfterMs: 0 })),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    apiKey: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    phrase: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}))

vi.mock('next/headers', () => ({ headers: vi.fn() }))

const { prisma } = await import('@/lib/prisma')
const { headers } = await import('next/headers')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockPrisma = prisma as any
const mockHeaders = vi.mocked(headers)

const VALID_KEY = 'kt_test_valid'

function fakeApiKey(key: string | null) {
  mockHeaders.mockResolvedValue({
    get: (name: string) => (name === 'x-api-key' ? key : null),
  } as unknown as Awaited<ReturnType<typeof headers>>)
}

function fakePhrase(overrides = {}) {
  return { id: 1, word: '中国', code: 'gvgg', type: 'Phrase', weight: 100, remark: null, ...overrides }
}

beforeEach(() => {
  vi.clearAllMocks()
  fakeApiKey(VALID_KEY)
  mockPrisma.apiKey.findUnique.mockResolvedValue({ id: 1, userId: 1, enabled: true, user: { status: 'ENABLE' } })
  mockPrisma.apiKey.update.mockResolvedValue({})
})

// ─── GET /api/v1/phrases/all ─────────────────────────────────────────────────

describe('GET /api/v1/phrases/all', () => {
  it('returns all Finish phrases without pagination', async () => {
    mockPrisma.phrase.findMany.mockResolvedValue([
      fakePhrase({ id: 1 }),
      fakePhrase({ id: 2, word: '美国', code: 'mlgg' }),
    ])

    const { GET } = await import('./all/route')
    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.phrases).toHaveLength(2)
    expect(body.total).toBe(2)
  })

  it('returns empty list when no Finish phrases exist', async () => {
    mockPrisma.phrase.findMany.mockResolvedValue([])

    const { GET } = await import('./all/route')
    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.phrases).toEqual([])
    expect(body.total).toBe(0)
  })

  it('queries only Finish status', async () => {
    mockPrisma.phrase.findMany.mockResolvedValue([])

    const { GET } = await import('./all/route')
    await GET()

    expect(mockPrisma.phrase.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'Finish' } })
    )
  })

  it('orders by code asc then weight asc', async () => {
    mockPrisma.phrase.findMany.mockResolvedValue([])

    const { GET } = await import('./all/route')
    await GET()

    expect(mockPrisma.phrase.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ code: 'asc' }, { weight: 'asc' }] })
    )
  })

  it('does not pass skip or take (no pagination)', async () => {
    mockPrisma.phrase.findMany.mockResolvedValue([])

    const { GET } = await import('./all/route')
    await GET()

    const call = mockPrisma.phrase.findMany.mock.calls[0][0]
    expect(call.skip).toBeUndefined()
    expect(call.take).toBeUndefined()
  })

  it('returns 401 without API key', async () => {
    fakeApiKey(null)
    const { GET } = await import('./all/route')
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('returns 401 with invalid API key', async () => {
    fakeApiKey('kt_invalid')
    mockPrisma.apiKey.findUnique.mockResolvedValue(null)
    const { GET } = await import('./all/route')
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('returns 403 when key is disabled', async () => {
    mockPrisma.apiKey.findUnique.mockResolvedValue({ id: 1, userId: 1, enabled: false, user: { status: 'ENABLE' } })
    const { GET } = await import('./all/route')
    const res = await GET()
    expect(res.status).toBe(403)
  })

  it('returns 429 when rate limited', async () => {
    const { checkRateLimit } = await import('@/lib/rateLimit')
    vi.mocked(checkRateLimit).mockReturnValueOnce({ allowed: false, retryAfterMs: 500 })

    const { GET } = await import('./all/route')
    const res = await GET()

    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('1')
  })
})

// ─── Auth checks (shared behavior across all v1 routes) ──────────────────────

describe('API key authentication', () => {
  it('returns 401 when X-API-Key header is missing', async () => {
    fakeApiKey(null)
    const { GET } = await import('./route')
    const res = await GET(new NextRequest('http://localhost/api/v1/phrases'))
    expect(res.status).toBe(401)
    expect((await res.json()).error).toMatch(/X-API-Key/)
  })

  it('returns 401 when key does not exist in DB', async () => {
    mockPrisma.apiKey.findUnique.mockResolvedValue(null)
    const { GET } = await import('./route')
    const res = await GET(new NextRequest('http://localhost/api/v1/phrases'))
    expect(res.status).toBe(401)
  })

  it('returns 403 when key is disabled', async () => {
    mockPrisma.apiKey.findUnique.mockResolvedValue({ id: 1, userId: 1, enabled: false, user: { status: 'ENABLE' } })
    const { GET } = await import('./route')
    const res = await GET(new NextRequest('http://localhost/api/v1/phrases'))
    expect(res.status).toBe(403)
  })

  it('returns 429 when rate limit is exceeded', async () => {
    const { checkRateLimit } = await import('@/lib/rateLimit')
    vi.mocked(checkRateLimit).mockReturnValueOnce({ allowed: false, retryAfterMs: 800 })

    const { GET } = await import('./route')
    const res = await GET(new NextRequest('http://localhost/api/v1/phrases'))

    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('1')
  })

  it('updates lastUsedAt and requestCount after successful auth', async () => {
    mockPrisma.phrase.findMany.mockResolvedValue([])
    mockPrisma.phrase.count.mockResolvedValue(0)

    const { GET } = await import('./route')
    await GET(new NextRequest('http://localhost/api/v1/phrases'))

    // Fire-and-forget update — flush microtasks
    await new Promise(r => setTimeout(r, 0))
    expect(mockPrisma.apiKey.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ requestCount: { increment: 1 } }),
      })
    )
  })
})

// ─── GET /api/v1/phrases ─────────────────────────────────────────────────────

describe('GET /api/v1/phrases', () => {
  it('returns paginated list without search', async () => {
    mockPrisma.phrase.findMany.mockResolvedValue([fakePhrase()])
    mockPrisma.phrase.count.mockResolvedValue(1)

    const { GET } = await import('./route')
    const res = await GET(new NextRequest('http://localhost/api/v1/phrases'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.phrases).toHaveLength(1)
    expect(body.total).toBe(1)
    expect(body.page).toBe(1)
    expect(body.pageSize).toBe(20)
  })

  it('caps pageSize at 100', async () => {
    mockPrisma.phrase.findMany.mockResolvedValue([])
    mockPrisma.phrase.count.mockResolvedValue(0)

    const { GET } = await import('./route')
    await GET(new NextRequest('http://localhost/api/v1/phrases?pageSize=999'))

    expect(mockPrisma.phrase.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 })
    )
  })

  it('skips correct number of rows for page 2', async () => {
    mockPrisma.phrase.findMany.mockResolvedValue([])
    mockPrisma.phrase.count.mockResolvedValue(0)

    const { GET } = await import('./route')
    await GET(new NextRequest('http://localhost/api/v1/phrases?page=2&pageSize=10'))

    expect(mockPrisma.phrase.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 10 })
    )
  })

  it('filters by type', async () => {
    mockPrisma.phrase.findMany.mockResolvedValue([fakePhrase({ type: 'Single' })])
    mockPrisma.phrase.count.mockResolvedValue(1)

    const { GET } = await import('./route')
    const res = await GET(new NextRequest('http://localhost/api/v1/phrases?type=Single'))

    expect(res.status).toBe(200)
    expect(mockPrisma.phrase.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ type: 'Single' }) })
    )
  })

  it('returns 400 for invalid type', async () => {
    const { GET } = await import('./route')
    const res = await GET(new NextRequest('http://localhost/api/v1/phrases?type=Fake'))
    expect(res.status).toBe(400)
  })

  it('searches with priority: exact → startsWith → contains', async () => {
    const exact = fakePhrase({ word: '中国', code: 'gvgg' })
    const prefix = fakePhrase({ id: 2, word: '中国人', code: 'gvggr' })
    const contains = fakePhrase({ id: 3, word: '美丽中国', code: 'mlgv' })

    // Route calls findMany three times for the three priority tiers
    mockPrisma.phrase.findMany
      .mockResolvedValueOnce([exact])
      .mockResolvedValueOnce([prefix])
      .mockResolvedValueOnce([contains])

    const { GET } = await import('./route')
    const res = await GET(new NextRequest('http://localhost/api/v1/phrases?search=中国'))
    const body = await res.json()

    expect(res.status).toBe(200)
    // Exact match comes first
    expect(body.phrases[0].word).toBe('中国')
    expect(body.phrases[1].word).toBe('中国人')
    expect(body.phrases[2].word).toBe('美丽中国')
  })

  it('only returns Finish status phrases', async () => {
    mockPrisma.phrase.findMany.mockResolvedValue([])
    mockPrisma.phrase.count.mockResolvedValue(0)

    const { GET } = await import('./route')
    await GET(new NextRequest('http://localhost/api/v1/phrases'))

    expect(mockPrisma.phrase.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'Finish' }) })
    )
  })
})

// ─── GET /api/v1/phrases/by-code ─────────────────────────────────────────────

describe('GET /api/v1/phrases/by-code', () => {
  it('returns phrases starting with code prefix', async () => {
    mockPrisma.phrase.findMany.mockResolvedValue([
      fakePhrase({ word: '中', code: 'gv', type: 'Single' }),
      fakePhrase({ id: 2, word: '中国', code: 'gvgg' }),
    ])
    mockPrisma.phrase.count.mockResolvedValue(2)

    const { GET } = await import('./by-code/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/phrases/by-code?code=gv'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.phrases).toHaveLength(2)
    expect(body.pagination).toMatchObject({ page: 1, pageSize: 6, total: 2, totalPages: 1 })
  })

  it('passes startsWith filter to DB', async () => {
    mockPrisma.phrase.findMany.mockResolvedValue([])
    mockPrisma.phrase.count.mockResolvedValue(0)

    const { GET } = await import('./by-code/route')
    await GET(new NextRequest('http://localhost/api/v1/phrases/by-code?code=gv'))

    expect(mockPrisma.phrase.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ code: { startsWith: 'gv' }, status: 'Finish' }),
      })
    )
  })

  it('paginates correctly on page 2', async () => {
    mockPrisma.phrase.findMany.mockResolvedValue([])
    mockPrisma.phrase.count.mockResolvedValue(10)

    const { GET } = await import('./by-code/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/phrases/by-code?code=gv&page=2'))
    const body = await res.json()

    expect(body.pagination.totalPages).toBe(2)
    expect(mockPrisma.phrase.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 6, take: 6 })
    )
  })

  it('returns 400 when code param is missing', async () => {
    const { GET } = await import('./by-code/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/phrases/by-code'))
    expect(res.status).toBe(400)
  })

  it('returns empty list when no phrases match prefix', async () => {
    mockPrisma.phrase.findMany.mockResolvedValue([])
    mockPrisma.phrase.count.mockResolvedValue(0)

    const { GET } = await import('./by-code/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/phrases/by-code?code=zzzzz'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.phrases).toHaveLength(0)
    expect(body.pagination.total).toBe(0)
  })
})

// ─── GET /api/v1/phrases/by-word ─────────────────────────────────────────────

describe('GET /api/v1/phrases/by-word', () => {
  it('returns all codes for an exact word', async () => {
    mockPrisma.phrase.findMany.mockResolvedValue([
      fakePhrase({ code: 'gvgg', weight: 100 }),
      fakePhrase({ id: 2, code: 'zguo', weight: 200 }),
    ])
    mockPrisma.phrase.count.mockResolvedValue(2)

    const { GET } = await import('./by-word/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/phrases/by-word?word=中国'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.phrases).toHaveLength(2)
    expect(body.pagination).toMatchObject({ total: 2, totalPages: 1 })
  })

  it('uses exact word match in DB query', async () => {
    mockPrisma.phrase.findMany.mockResolvedValue([])
    mockPrisma.phrase.count.mockResolvedValue(0)

    const { GET } = await import('./by-word/route')
    await GET(new NextRequest('http://localhost/api/v1/phrases/by-word?word=中国'))

    expect(mockPrisma.phrase.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ word: '中国', status: 'Finish' }),
      })
    )
  })

  it('paginates with 6 items per page', async () => {
    mockPrisma.phrase.findMany.mockResolvedValue([])
    mockPrisma.phrase.count.mockResolvedValue(7)

    const { GET } = await import('./by-word/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/phrases/by-word?word=中国'))
    const body = await res.json()

    expect(body.pagination.totalPages).toBe(2)
    expect(mockPrisma.phrase.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 6 })
    )
  })

  it('returns empty list when word has no match', async () => {
    mockPrisma.phrase.findMany.mockResolvedValue([])
    mockPrisma.phrase.count.mockResolvedValue(0)

    const { GET } = await import('./by-word/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/phrases/by-word?word=不存在的词'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.phrases).toHaveLength(0)
  })

  it('returns 400 when word param is missing', async () => {
    const { GET } = await import('./by-word/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/phrases/by-word'))
    expect(res.status).toBe(400)
  })
})
