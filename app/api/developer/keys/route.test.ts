import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Mock rate limiter so it never blocks in tests
vi.mock('@/lib/rateLimit', () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true, retryAfterMs: 0 })),
}))

// Mock Prisma
vi.mock('@/lib/prisma', () => ({
  prisma: {
    apiKey: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
    },
    phrase: {
      findMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
  },
}))

vi.mock('next/headers', () => ({ headers: vi.fn() }))

vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>()
  return { ...actual, getSession: vi.fn() }
})

const { prisma } = await import('@/lib/prisma')
const { headers } = await import('next/headers')
const { getSession } = await import('@/lib/auth')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockPrisma = prisma as any
const mockHeaders = vi.mocked(headers)
const mockGetSession = vi.mocked(getSession)

function fakeSession(id = 1, name = 'testuser') {
  mockGetSession.mockResolvedValue({ id, name })
}

function fakeApiKey(key: string | null) {
  mockHeaders.mockResolvedValue({
    get: (name: string) => (name === 'x-api-key' ? key : null),
  } as unknown as Awaited<ReturnType<typeof headers>>)
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── GET /api/developer/keys ─────────────────────────────────────────────────

describe('GET /api/developer/keys', () => {
  it('returns keys for authenticated user', async () => {
    fakeSession()
    mockPrisma.apiKey.findMany.mockResolvedValue([
      { id: 1, name: 'My Key', key: 'kt_abc', enabled: true, createdAt: new Date(), lastUsedAt: null, requestCount: 0, userId: 1 },
    ])

    const { GET } = await import('./route')
    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.keys).toHaveLength(1)
    expect(body.keys[0].name).toBe('My Key')
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)
    const { GET } = await import('./route')
    const res = await GET()
    expect(res.status).toBe(401)
  })
})

// ─── POST /api/developer/keys ────────────────────────────────────────────────

describe('POST /api/developer/keys', () => {
  function postReq(body: unknown) {
    return new NextRequest('http://localhost/api/developer/keys', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  it('creates a key with kt_ prefix', async () => {
    fakeSession()
    mockPrisma.apiKey.count.mockResolvedValue(0)
    mockPrisma.apiKey.create.mockResolvedValue({
      id: 1, name: 'My Script', key: 'kt_generatedkey', enabled: true,
      createdAt: new Date(), lastUsedAt: null, requestCount: 0, userId: 1,
    })

    const { POST } = await import('./route')
    const res = await POST(postReq({ name: 'My Script' }))
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.key.name).toBe('My Script')
    expect(mockPrisma.apiKey.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: 'My Script', userId: 1 }) })
    )
  })

  it('rejects empty name', async () => {
    fakeSession()
    const { POST } = await import('./route')
    const res = await POST(postReq({ name: '   ' }))
    expect(res.status).toBe(400)
    expect(mockPrisma.apiKey.create).not.toHaveBeenCalled()
  })

  it('enforces 5-key limit per user', async () => {
    fakeSession()
    mockPrisma.apiKey.count.mockResolvedValue(5)

    const { POST } = await import('./route')
    const res = await POST(postReq({ name: 'One More' }))

    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('5')
    expect(mockPrisma.apiKey.create).not.toHaveBeenCalled()
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)
    const { POST } = await import('./route')
    const res = await POST(postReq({ name: 'Test' }))
    expect(res.status).toBe(401)
  })
})

// ─── DELETE /api/developer/keys/[id] ─────────────────────────────────────────

describe('DELETE /api/developer/keys/[id]', () => {
  function deleteReq(id: number) {
    return new NextRequest(`http://localhost/api/developer/keys/${id}`, { method: 'DELETE' })
  }

  it('deletes own key', async () => {
    fakeSession(1)
    mockPrisma.apiKey.findUnique.mockResolvedValue({ id: 1, userId: 1 } as never)
    mockPrisma.apiKey.delete.mockResolvedValue({} as never)

    const { DELETE } = await import('./[id]/route')
    const res = await DELETE(deleteReq(1), { params: Promise.resolve({ id: '1' }) })

    expect(res.status).toBe(200)
    expect(mockPrisma.apiKey.delete).toHaveBeenCalledWith({ where: { id: 1 } })
  })

  it("returns 404 for another user's key", async () => {
    fakeSession(1)
    mockPrisma.apiKey.findUnique.mockResolvedValue({ id: 2, userId: 99 } as never)

    const { DELETE } = await import('./[id]/route')
    const res = await DELETE(deleteReq(2), { params: Promise.resolve({ id: '2' }) })

    expect(res.status).toBe(404)
    expect(mockPrisma.apiKey.delete).not.toHaveBeenCalled()
  })

  it('returns 404 for non-existent key', async () => {
    fakeSession(1)
    mockPrisma.apiKey.findUnique.mockResolvedValue(null)

    const { DELETE } = await import('./[id]/route')
    const res = await DELETE(deleteReq(999), { params: Promise.resolve({ id: '999' }) })

    expect(res.status).toBe(404)
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)
    const { DELETE } = await import('./[id]/route')
    const res = await DELETE(deleteReq(1), { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(401)
  })
})

