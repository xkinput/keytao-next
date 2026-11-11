import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  checkRateLimit: vi.fn(),
  configured: vi.fn(),
  presignPut: vi.fn(),
  presignGet: vi.fn(),
  headObject: vi.fn(),
  deleteObject: vi.fn(),
  profile: { findUnique: vi.fn(), upsert: vi.fn() },
  packages: {
    findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(),
    count: vi.fn(), create: vi.fn(), update: vi.fn(),
    delete: vi.fn(), deleteMany: vi.fn(),
  },
  queryRaw: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/rateLimit', () => ({ checkRateLimit: mocks.checkRateLimit }))
vi.mock('@/lib/objectStorage', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/objectStorage')>(),
  isObjectStorageConfigured: mocks.configured,
  presignPut: mocks.presignPut,
  presignGet: mocks.presignGet,
  headObject: mocks.headObject,
  deleteObject: mocks.deleteObject,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    schemeProfile: mocks.profile,
    schemePackage: mocks.packages,
    $queryRaw: mocks.queryRaw,
    $transaction: mocks.transaction,
  },
}))

const USER_ID = 7
const SHA256 = 'a'.repeat(64)
const CREATED_AT = new Date('2026-11-11T01:00:00Z')
const pendingPackage = {
  id: 12, userId: USER_ID, schemeKey: 'keytao', name: 'My scheme', version: '1.0',
  size: 1024, sha256: SHA256, storageKey: 'scheme-packages/7/example.zip',
  status: 'PENDING', createAt: CREATED_AT,
}
const packageMetadata = {
  schemeKey: 'keytao', name: 'My scheme', version: '1.0', size: 1024, sha256: SHA256,
}

function request(method: string, body?: unknown, suffix = '') {
  return new NextRequest(`http://localhost/api/user/scheme-packages${suffix}`, {
    method,
    ...(body === undefined ? {} : {
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }),
  })
}

function context(id = 12) {
  return { params: Promise.resolve({ id: String(id) }) }
}

const routeCases = [
  {
    name: 'profile GET', storage: false,
    invoke: async () => (await import('./scheme-profile/route')).GET(),
  },
  {
    name: 'profile PUT', storage: false,
    invoke: async () => (await import('./scheme-profile/route')).PUT(request('PUT', { data: {} })),
  },
  {
    name: 'packages GET', storage: true,
    invoke: async () => (await import('./scheme-packages/route')).GET(),
  },
  {
    name: 'packages POST', storage: true,
    invoke: async () => (await import('./scheme-packages/route')).POST(request('POST', packageMetadata)),
  },
  {
    name: 'complete POST', storage: true,
    invoke: async () => (await import('./scheme-packages/[id]/complete/route')).POST(request('POST', undefined, '/12/complete'), context()),
  },
  {
    name: 'package GET', storage: true,
    invoke: async () => (await import('./scheme-packages/[id]/route')).GET(request('GET', undefined, '/12'), context()),
  },
  {
    name: 'package DELETE', storage: true,
    invoke: async () => (await import('./scheme-packages/[id]/route')).DELETE(request('DELETE', undefined, '/12'), context()),
  },
]

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-11T01:01:00Z'))
  mocks.getSession.mockResolvedValue({ id: USER_ID, name: 'testuser' })
  mocks.checkRateLimit.mockReturnValue({ allowed: true, retryAfterMs: 0 })
  mocks.configured.mockReturnValue(true)
  mocks.presignPut.mockResolvedValue({ url: 'https://storage.invalid/upload', headers: { 'content-length': '1024' } })
  mocks.presignGet.mockResolvedValue('https://storage.invalid/download')
  mocks.headObject.mockResolvedValue({ size: 1024 })
  mocks.deleteObject.mockResolvedValue(undefined)
  mocks.profile.findUnique.mockResolvedValue(null)
  mocks.profile.upsert.mockResolvedValue({ data: {}, updateAt: CREATED_AT })
  mocks.packages.findMany.mockResolvedValue([])
  mocks.packages.findFirst.mockResolvedValue(pendingPackage)
  mocks.packages.findUnique.mockResolvedValue(pendingPackage)
  mocks.packages.count.mockResolvedValue(0)
  mocks.packages.create.mockResolvedValue(pendingPackage)
  mocks.packages.update.mockResolvedValue({ ...pendingPackage, status: 'READY' })
  mocks.packages.delete.mockResolvedValue(pendingPackage)
  mocks.packages.deleteMany.mockResolvedValue({ count: 0 })
  mocks.queryRaw.mockResolvedValue([{ id: USER_ID }])
  mocks.transaction.mockImplementation(async (operation: unknown) => {
    if (typeof operation === 'function') {
      return operation({ schemeProfile: mocks.profile, schemePackage: mocks.packages, $queryRaw: mocks.queryRaw })
    }
    return Promise.all(operation as Promise<unknown>[])
  })
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network request') }))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('scheme sync authentication and rate limits', () => {
  it.each(routeCases)('$name requires authentication', async ({ invoke }) => {
    mocks.getSession.mockResolvedValue(null)
    const res = await invoke()
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: '未登录' })
    expect(mocks.checkRateLimit).not.toHaveBeenCalled()
    expect(mocks.deleteObject).not.toHaveBeenCalled()
  })

  it.each(routeCases)('$name limits requests by authenticated user', async ({ invoke }) => {
    mocks.checkRateLimit.mockReturnValue({ allowed: false, retryAfterMs: 500 })
    const res = await invoke()
    expect(res.status).toBe(429)
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(expect.stringContaining(String(USER_ID)))
    expect(mocks.profile.upsert).not.toHaveBeenCalled()
    expect(mocks.packages.create).not.toHaveBeenCalled()
    expect(mocks.deleteObject).not.toHaveBeenCalled()
  })

  it.each(routeCases.filter(route => route.storage))('$name returns 503 when storage is not configured', async ({ invoke }) => {
    mocks.configured.mockReturnValue(false)
    const res = await invoke()
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: expect.any(String) })
    expect(mocks.packages.create).not.toHaveBeenCalled()
    expect(mocks.headObject).not.toHaveBeenCalled()
    expect(mocks.deleteObject).not.toHaveBeenCalled()
  })
})

describe('scheme profiles', () => {
  it('returns an empty profile without needing storage configuration', async () => {
    mocks.configured.mockReturnValue(false)
    const { GET } = await import('./scheme-profile/route')
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ profile: null, updateAt: null })
    expect(mocks.profile.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: USER_ID } }))
  })

  it('returns only the authenticated user profile and timestamp', async () => {
    mocks.profile.findUnique.mockResolvedValue({ data: { active: 'keytao' }, updateAt: CREATED_AT })
    const { GET } = await import('./scheme-profile/route')
    const res = await GET()
    expect(await res.json()).toEqual({ profile: { active: 'keytao' }, updateAt: CREATED_AT.toISOString() })
  })

  it('upserts object data for the authenticated user', async () => {
    const data = { active: 'keytao', options: { punctuation: true } }
    mocks.profile.upsert.mockResolvedValue({ data, updateAt: CREATED_AT })
    const { PUT } = await import('./scheme-profile/route')
    const res = await PUT(request('PUT', { data, userId: 99 }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ profile: data, updateAt: CREATED_AT.toISOString() })
    expect(mocks.profile.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: USER_ID }, create: { userId: USER_ID, data }, update: { data },
    }))
  })

  it.each([null, [], 'text', 42, true, undefined])('rejects non-object profile data: %j', async data => {
    const { PUT } = await import('./scheme-profile/route')
    const res = await PUT(request('PUT', { data }))
    expect(res.status).toBe(400)
    expect(mocks.profile.upsert).not.toHaveBeenCalled()
  })

  it('rejects malformed JSON', async () => {
    const { PUT } = await import('./scheme-profile/route')
    const res = await PUT(new NextRequest('http://localhost/api/user/scheme-profile', { method: 'PUT', body: '{' }))
    expect(res.status).toBe(400)
    expect(mocks.profile.upsert).not.toHaveBeenCalled()
  })

  it('rejects a profile body larger than 256 KiB without a content-length header', async () => {
    const { PUT } = await import('./scheme-profile/route')
    const res = await PUT(request('PUT', { data: { text: 'x'.repeat(256 * 1024) } }))
    expect(res.status).toBe(413)
    expect(mocks.profile.upsert).not.toHaveBeenCalled()
  })
})

describe('scheme package metadata', () => {
  it('lists READY packages belonging to the current user without exposing storage keys', async () => {
    const { GET } = await import('./scheme-packages/route')
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ packages: [] })
    expect(mocks.packages.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: USER_ID, status: 'READY' },
      select: { id: true, schemeKey: true, name: true, version: true, size: true, sha256: true, createAt: true },
    }))
  })

  it('creates a PENDING upload using a server-generated storage key', async () => {
    const { POST } = await import('./scheme-packages/route')
    const res = await POST(request('POST', { ...packageMetadata, userId: 99, storageKey: 'arbitrary' }))
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ id: 12, uploadUrl: 'https://storage.invalid/upload', headers: { 'content-length': '1024' } })
    expect(mocks.packages.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      ...packageMetadata, userId: USER_ID, status: 'PENDING',
      storageKey: expect.stringMatching(/^scheme-packages\/7\/[0-9a-f-]{36}\.zip$/),
    }) }))
    const created = mocks.packages.create.mock.calls[0][0].data
    expect(mocks.presignPut).toHaveBeenCalledWith(created.storageKey, { contentLength: 1024, sha256: SHA256 })
  })

  it.each([
    ['zero size', { size: 0 }], ['negative size', { size: -1 }], ['fractional size', { size: 1.5 }],
    ['oversize', { size: 30 * 1024 * 1024 + 1 }], ['string size', { size: '1024' }],
    ['short checksum', { sha256: 'a'.repeat(63) }], ['non-hex checksum', { sha256: 'g'.repeat(64) }],
    ['empty name', { name: '' }], ['blank name', { name: '   ' }], ['long name', { name: 'a'.repeat(101) }],
    ['empty key', { schemeKey: '' }], ['blank key', { schemeKey: '   ' }], ['long key', { schemeKey: 'a'.repeat(41) }],
    ['non-string version', { version: 5 }],
  ])('rejects %s', async (_name, overrides) => {
    const { POST } = await import('./scheme-packages/route')
    const res = await POST(request('POST', { ...packageMetadata, ...overrides }))
    expect(res.status).toBe(400)
    expect(mocks.packages.create).not.toHaveBeenCalled()
    expect(mocks.presignPut).not.toHaveBeenCalled()
  })

  it.each([1, 30 * 1024 * 1024])('accepts valid size boundary %i', async size => {
    const { POST } = await import('./scheme-packages/route')
    const res = await POST(request('POST', { ...packageMetadata, size, version: undefined, sha256: SHA256.toUpperCase() }))
    expect(res.status).toBe(201)
  })

  it('rejects malformed package JSON', async () => {
    const { POST } = await import('./scheme-packages/route')
    const res = await POST(new NextRequest('http://localhost/api/user/scheme-packages', { method: 'POST', body: '{' }))
    expect(res.status).toBe(400)
    expect(mocks.packages.create).not.toHaveBeenCalled()
  })

  it.each([['READY', 20], ['PENDING', 5]])('enforces the %s package quota', async (status, count) => {
    mocks.packages.count.mockImplementation(async ({ where }) => where.status === status ? count : 0)
    const { POST } = await import('./scheme-packages/route')
    const res = await POST(request('POST', packageMetadata))
    expect(res.status).toBe(400)
    for (const [query] of mocks.packages.count.mock.calls) {
      expect(query.where.userId).toBe(USER_ID)
    }
    expect(mocks.packages.create).not.toHaveBeenCalled()
    expect(mocks.presignPut).not.toHaveBeenCalled()
  })

  it('drops stale PENDING metadata before counting quotas under a per-user lock', async () => {
    const { POST } = await import('./scheme-packages/route')
    const res = await POST(request('POST', packageMetadata))
    expect(res.status).toBe(201)
    expect(mocks.transaction).toHaveBeenCalled()
    expect(mocks.queryRaw).toHaveBeenCalled()
    expect(mocks.packages.deleteMany).toHaveBeenCalledWith({ where: {
      userId: USER_ID, status: 'PENDING', createAt: { lt: expect.any(Date) },
    } })
    const cutoff = mocks.packages.deleteMany.mock.calls[0][0].where.createAt.lt
    expect(cutoff).toEqual(new Date('2026-11-11T00:50:00Z'))
    expect(mocks.packages.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(mocks.packages.count.mock.invocationCallOrder[0])
  })

  it('deletes expired uploads before dropping their metadata', async () => {
    const records = [
      { storageKey: pendingPackage.storageKey, createAt: new Date('2026-11-11T00:49:59.999Z') },
      { storageKey: 'scheme-packages/7/another.zip', createAt: new Date('2026-11-11T00:49:00Z') },
      { storageKey: 'scheme-packages/7/at-cutoff.zip', createAt: new Date('2026-11-11T00:50:00Z') },
      pendingPackage,
    ]
    mocks.packages.findMany.mockImplementation(async ({ where }) =>
      records.filter(record => record.createAt < where.createAt.lt))
    const { POST } = await import('./scheme-packages/route')
    const res = await POST(request('POST', packageMetadata))
    expect(res.status).toBe(201)
    expect(mocks.packages.findMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, status: 'PENDING', createAt: { lt: expect.any(Date) } },
      select: { storageKey: true },
    })
    expect(mocks.deleteObject).toHaveBeenCalledWith(pendingPackage.storageKey)
    expect(mocks.deleteObject).toHaveBeenCalledWith('scheme-packages/7/another.zip')
    expect(mocks.deleteObject).toHaveBeenCalledTimes(2)
    for (const order of mocks.deleteObject.mock.invocationCallOrder) {
      expect(order).toBeLessThan(mocks.packages.deleteMany.mock.invocationCallOrder[0])
    }
    expect(mocks.packages.findMany.mock.calls[0][0].where).toEqual(mocks.packages.deleteMany.mock.calls[0][0].where)
    expect(mocks.queryRaw.mock.invocationCallOrder[0]).toBeLessThan(mocks.packages.findMany.mock.invocationCallOrder[0])
  })

  it('keeps expired upload metadata when storage cleanup fails', async () => {
    mocks.packages.findMany.mockResolvedValue([{ storageKey: pendingPackage.storageKey }])
    mocks.deleteObject.mockRejectedValue(new Error('Storage unavailable'))
    const { POST } = await import('./scheme-packages/route')
    const res = await POST(request('POST', packageMetadata))
    expect(res.status).toBeGreaterThanOrEqual(500)
    expect(mocks.packages.deleteMany).not.toHaveBeenCalled()
    expect(mocks.packages.create).not.toHaveBeenCalled()
  })
})

describe('scheme package completion and ownership', () => {
  it('marks the package READY after verifying its declared size', async () => {
    const { POST } = await import('./scheme-packages/[id]/complete/route')
    const res = await POST(request('POST', undefined, '/12/complete'), context())
    expect(res.status).toBe(200)
    expect(mocks.headObject).toHaveBeenCalledWith(pendingPackage.storageKey)
    expect(mocks.packages.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 12 }, data: { status: 'READY' } }))
  })

  it('enforces the READY quota again when completing pending uploads', async () => {
    mocks.packages.count.mockImplementation(async ({ where }) => where.status === 'READY' ? 20 : 0)
    const { POST } = await import('./scheme-packages/[id]/complete/route')
    const res = await POST(request('POST', undefined, '/12/complete'), context())
    expect(res.status).toBe(400)
    expect(mocks.packages.update).not.toHaveBeenCalled()
  })

  it('deletes a mismatched object but keeps PENDING metadata while its PUT URL is valid', async () => {
    mocks.headObject.mockResolvedValue({ size: 1025 })
    const { POST } = await import('./scheme-packages/[id]/complete/route')
    const res = await POST(request('POST', undefined, '/12/complete'), context())
    expect(res.status).toBe(400)
    expect(mocks.deleteObject).toHaveBeenCalledWith(pendingPackage.storageKey)
    expect(mocks.packages.delete).not.toHaveBeenCalled()
    expect(mocks.packages.deleteMany).not.toHaveBeenCalled()
    expect(mocks.packages.update).not.toHaveBeenCalled()
  })

  it('keeps PENDING metadata when completion runs before the PUT finishes', async () => {
    mocks.headObject.mockResolvedValue(null)
    const { POST } = await import('./scheme-packages/[id]/complete/route')
    const res = await POST(request('POST', undefined, '/12/complete'), context())
    expect(res.status).toBe(400)
    expect(mocks.deleteObject).not.toHaveBeenCalled()
    expect(mocks.packages.delete).not.toHaveBeenCalled()
    expect(mocks.packages.deleteMany).not.toHaveBeenCalled()
    expect(mocks.packages.update).not.toHaveBeenCalled()
  })

  it('allows a delayed PUT to complete using the preserved PENDING row', async () => {
    let record: typeof pendingPackage | null = { ...pendingPackage }
    mocks.packages.findUnique.mockImplementation(async () => record)
    mocks.packages.delete.mockImplementation(async () => { record = null })
    mocks.headObject.mockResolvedValueOnce(null).mockResolvedValueOnce({ size: pendingPackage.size })
    const { POST } = await import('./scheme-packages/[id]/complete/route')

    expect((await POST(request('POST', undefined, '/12/complete'), context())).status).toBe(400)
    expect((await POST(request('POST', undefined, '/12/complete'), context())).status).toBe(200)
    expect(mocks.packages.update).toHaveBeenCalledWith({ where: { id: 12 }, data: { status: 'READY' } })
  })

  it.each(routeCases.filter(route => ['complete POST', 'package GET', 'package DELETE'].includes(route.name)))('$name hides packages owned by another user', async ({ invoke }) => {
    const other = { ...pendingPackage, userId: 99, status: 'READY' }
    mocks.packages.findUnique.mockResolvedValue(other)
    mocks.packages.findFirst.mockImplementation(async ({ where }) => where.userId === USER_ID ? null : other)
    const res = await invoke()
    expect(res.status).toBe(404)
    expect(mocks.presignGet).not.toHaveBeenCalled()
    expect(mocks.headObject).not.toHaveBeenCalled()
    expect(mocks.deleteObject).not.toHaveBeenCalled()
    expect(mocks.packages.delete).not.toHaveBeenCalled()
    expect(mocks.packages.update).not.toHaveBeenCalled()
  })

  it.each(routeCases.filter(route => ['complete POST', 'package GET', 'package DELETE'].includes(route.name)))('$name returns 404 for nonexistent metadata', async ({ invoke }) => {
    mocks.packages.findUnique.mockResolvedValue(null)
    mocks.packages.findFirst.mockResolvedValue(null)
    const res = await invoke()
    expect(res.status).toBe(404)
    expect(mocks.presignGet).not.toHaveBeenCalled()
    expect(mocks.headObject).not.toHaveBeenCalled()
    expect(mocks.deleteObject).not.toHaveBeenCalled()
  })

  it('does not expose a download URL for a PENDING package', async () => {
    const { GET } = await import('./scheme-packages/[id]/route')
    const res = await GET(request('GET', undefined, '/12'), context())
    expect(res.status).toBe(404)
    expect(mocks.presignGet).not.toHaveBeenCalled()
  })

  it('redirects to a signed download URL for the owner of a READY package', async () => {
    mocks.packages.findUnique.mockResolvedValue({ ...pendingPackage, status: 'READY' })
    mocks.packages.findFirst.mockResolvedValue({ ...pendingPackage, status: 'READY' })
    const { GET } = await import('./scheme-packages/[id]/route')
    const res = await GET(request('GET', undefined, '/12'), context())
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://storage.invalid/download')
    expect(mocks.presignGet).toHaveBeenCalledWith(pendingPackage.storageKey, expect.any(String))
  })

  it.each(['PENDING', 'READY'].flatMap(status => [0, 600_000, 659_999, 660_000].map(ageMs => ({ status, ageMs }))))(
    'rejects deletion of a $status package at age $ageMs ms while its PUT URL may still be used', async ({ status, ageMs }) => {
      mocks.packages.findUnique.mockResolvedValue({ ...pendingPackage, status, createAt: new Date(Date.now() - ageMs) })
      const { DELETE } = await import('./scheme-packages/[id]/route')
      const res = await DELETE(request('DELETE', undefined, '/12'), context())
      expect(res.status).toBe(409)
      expect(await res.json()).toEqual({ error: expect.any(String) })
      expect(mocks.deleteObject).not.toHaveBeenCalled()
      expect(mocks.packages.delete).not.toHaveBeenCalled()
      expect(mocks.packages.deleteMany).not.toHaveBeenCalled()
    }
  )

  it.each(['PENDING', 'READY'])('deletes storage before deleting expired %s metadata', async status => {
    mocks.packages.findUnique.mockResolvedValue({ ...pendingPackage, status, createAt: new Date(Date.now() - 660_001) })
    const { DELETE } = await import('./scheme-packages/[id]/route')
    const res = await DELETE(request('DELETE', undefined, '/12'), context())
    expect(res.status).toBe(200)
    expect(mocks.deleteObject).toHaveBeenCalledWith(pendingPackage.storageKey)
    expect(mocks.packages.delete).toHaveBeenCalledWith({ where: { id: 12 } })
    expect(mocks.deleteObject.mock.invocationCallOrder[0]).toBeLessThan(mocks.packages.delete.mock.invocationCallOrder[0])
  })

  it('preserves metadata when deleting storage fails', async () => {
    mocks.packages.findUnique.mockResolvedValue({ ...pendingPackage, createAt: new Date(Date.now() - 660_001) })
    mocks.deleteObject.mockRejectedValue(new Error('Storage unavailable'))
    const { DELETE } = await import('./scheme-packages/[id]/route')
    const res = await DELETE(request('DELETE', undefined, '/12'), context())
    expect(res.status).toBeGreaterThanOrEqual(500)
    expect(mocks.packages.delete).not.toHaveBeenCalled()
  })

  it('preserves metadata when mismatch cleanup fails', async () => {
    mocks.headObject.mockResolvedValue({ size: 1 })
    mocks.deleteObject.mockRejectedValue(new Error('Storage unavailable'))
    const { POST } = await import('./scheme-packages/[id]/complete/route')
    const res = await POST(request('POST', undefined, '/12/complete'), context())
    expect(res.status).toBeGreaterThanOrEqual(500)
    expect(mocks.packages.delete).not.toHaveBeenCalled()
    expect(mocks.packages.update).not.toHaveBeenCalled()
  })
})
