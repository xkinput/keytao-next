import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
const { hashApiKey, verifyApiKey } = await import('@/lib/apiKeyAuth')
const { decryptApiKey, encryptApiKey } = await import('@/lib/apiKeySecrets')

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
  vi.stubEnv('API_KEY_ENCRYPTION_KEY', 'a5'.repeat(32))
})
afterEach(() => vi.unstubAllEnvs())

// ─── GET /api/developer/keys ─────────────────────────────────────────────────

describe('GET /api/developer/keys', () => {
  it('returns keys for authenticated user', async () => {
    fakeSession()
    mockPrisma.apiKey.findMany.mockResolvedValue([
      { id: 1, name: 'My Key', keyPrefix: 'kt_abc', enabled: true, createdAt: new Date(), lastUsedAt: null, requestCount: 0 },
    ])

    const { GET } = await import('./route')
    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.keys).toHaveLength(1)
    expect(body.keys[0].name).toBe('My Key')
    expect(mockPrisma.apiKey.findMany.mock.calls[0][0].select).not.toHaveProperty('encryptedKey')
    expect(mockPrisma.apiKey.findMany.mock.calls[0][0].select).not.toHaveProperty('keyHash')
    expect(body.keys[0]).not.toHaveProperty('plaintextKey')
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

  it('creates a key with its hash and encrypted secret', async () => {
    fakeSession()
    mockPrisma.apiKey.count.mockResolvedValue(0)
    mockPrisma.apiKey.create.mockResolvedValue({
      id: 1, name: 'My Script', keyPrefix: 'kt_abcde', enabled: true,
      createdAt: new Date(), lastUsedAt: null, requestCount: 0,
    })

    const { POST } = await import('./route')
    const res = await POST(postReq({ name: 'My Script' }))
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(res.headers.get('cache-control')).toContain('no-store')
    expect(body.key.name).toBe('My Script')
    expect(body.key.plaintextKey).toMatch(/^kt_[a-z0-9_-]{32}$/i)
    expect(body.key).not.toHaveProperty('encryptedKey')
    const { data } = mockPrisma.apiKey.create.mock.calls[0][0]
    expect(data).toMatchObject({ name: 'My Script', userId: 1, keyHash: hashApiKey(body.key.plaintextKey) })
    expect(data).not.toHaveProperty('plaintextKey')
    expect(decryptApiKey(data.encryptedKey, 1, data.keyHash)).toBe(body.key.plaintextKey)
  })

  it('does not create a hash-only key when encryption is unconfigured', async () => {
    fakeSession()
    mockPrisma.apiKey.count.mockResolvedValue(0)
    vi.stubEnv('API_KEY_ENCRYPTION_KEY', '')
    const { POST } = await import('./route')

    expect((await POST(postReq({ name: 'Missing encryption key' }))).status).toBe(503)
    expect(mockPrisma.apiKey.create).not.toHaveBeenCalled()
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

describe('POST /api/developer/keys/[id]', () => {
  async function reveal(id = '1') {
    const { POST } = await import('./[id]/route')
    const request = new NextRequest(`http://localhost/api/developer/keys/${id}`, { method: 'POST' })
    return POST(request, { params: Promise.resolve({ id }) })
  }

  it('reveals the same complete key repeatedly with no-store caching', async () => {
    fakeSession(42)
    const plaintextKey = 'kt_test_reveal'
    const keyHash = hashApiKey(plaintextKey)
    mockPrisma.apiKey.findUnique.mockResolvedValue({ keyHash, encryptedKey: encryptApiKey(plaintextKey, 42, keyHash) })

    for (const response of [await reveal(), await reveal()]) {
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      expect(await response.json()).toEqual({ plaintextKey })
    }
    expect(mockPrisma.apiKey.findUnique).toHaveBeenCalledWith({
      where: { id: 1, userId: 42, enabled: true },
      select: { keyHash: true, encryptedKey: true },
    })
  })

  it('requires a session and a valid key ID', async () => {
    mockGetSession.mockResolvedValue(null)
    expect((await reveal()).status).toBe(401)
    fakeSession()
    expect((await reveal('1abc')).status).toBe(400)
    expect(mockPrisma.apiKey.findUnique).not.toHaveBeenCalled()
  })

  it('returns 404 when no enabled key belongs to the user', async () => {
    fakeSession()
    mockPrisma.apiKey.findUnique.mockResolvedValue(null)
    expect((await reveal()).status).toBe(404)
  })

  it('explains why a hash-only key is unavailable until its next authenticated use', async () => {
    fakeSession()
    mockPrisma.apiKey.findUnique.mockResolvedValue({ keyHash: 'legacy-hash', encryptedKey: null })
    const response = await reveal()
    expect(response.status).toBe(409)
    expect((await response.json()).error).toContain('成功调用一次 API')
  })

  it('cannot disclose ciphertext under a different record hash', async () => {
    fakeSession()
    mockPrisma.apiKey.findUnique.mockResolvedValue({
      keyHash: hashApiKey('kt_different'),
      encryptedKey: encryptApiKey('kt_test_value', 1, hashApiKey('kt_test_value')),
    })
    expect((await reveal()).status).toBe(503)
  })
})

describe('hash-only API key compatibility', () => {
  const plaintext = 'kt_test_legacy_key'
  const keyHash = hashApiKey(plaintext)
  const legacyKey = { id: 4, userId: 42, enabled: true, encryptedKey: null, user: { status: 'ENABLE' } }

  it('stores an encrypted copy on successful authentication with the original key', async () => {
    fakeApiKey(plaintext)
    mockPrisma.apiKey.findUnique.mockResolvedValue(legacyKey)
    mockPrisma.apiKey.update.mockResolvedValue({})

    expect(await verifyApiKey()).toEqual({ success: true, ctx: { userId: 42, apiKeyId: 4 } })
    expect(mockPrisma.apiKey.findUnique.mock.calls[0][0].where).toEqual({ keyHash })
    const { data } = mockPrisma.apiKey.update.mock.calls[0][0]
    expect(data.requestCount).toEqual({ increment: 1 })
    expect(decryptApiKey(data.encryptedKey, 42, keyHash)).toBe(plaintext)
  })

  it('continues accepting legacy keys without encryption configuration', async () => {
    vi.stubEnv('API_KEY_ENCRYPTION_KEY', '')
    fakeApiKey(plaintext)
    mockPrisma.apiKey.findUnique.mockResolvedValue(legacyKey)
    mockPrisma.apiKey.update.mockResolvedValue({})

    expect((await verifyApiKey()).success).toBe(true)
    expect(mockPrisma.apiKey.update.mock.calls[0][0].data).not.toHaveProperty('encryptedKey')
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

