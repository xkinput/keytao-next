// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { SignJWT } from 'jose'

const mocks = vi.hoisted(() => ({
  authorization: '',
  user: { id: 1, name: 'rea', password: 'old-hash', status: 'ENABLE', tokenVersion: 0, roles: [{ value: 'R:ROOT' }] },
  findUnique: vi.fn(),
  findProfile: vi.fn(),
  update: vi.fn(),
  updateManyAndReturn: vi.fn(),
  compare: vi.fn(),
  hash: vi.fn(),
}))

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ authorization: mocks.authorization }),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { schemeProfile: { findUnique: mocks.findProfile }, user: {
    findUnique: mocks.findUnique,
    update: mocks.update,
    updateManyAndReturn: mocks.updateManyAndReturn,
  } },
}))
vi.mock('@/lib/rateLimit', () => ({
  checkRateLimit: () => ({ allowed: true, retryAfterMs: 0 }),
}))
vi.mock('bcrypt', () => ({ default: { compare: mocks.compare, hash: mocks.hash } }))

const TEST_SECRET = 'token-revocation-test-secret'
vi.stubEnv('JWT_SECRET', TEST_SECRET)
const { signToken, verifyToken, getSession } = await import('@/lib/auth')
const { POST: logoutAll } = await import('./logout-all/route')
const { POST: refresh } = await import('./refresh/route')
const { POST: changePassword } = await import('../user/change-password/route')
const { GET: getProfile } = await import('../user/scheme-profile/route')
const { checkAdminPermission, checkRootAdminPermission } = await import('@/lib/adminAuth')

function request(path: string, body?: unknown) {
  return new NextRequest(`http://localhost/api/${path}`, {
    method: 'POST',
    headers: { authorization: mocks.authorization, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

async function authorize() {
  const token = await signToken({ id: 1, name: 'rea', tv: mocks.user.tokenVersion })
  mocks.authorization = `Bearer ${token}`
  return token
}

async function rawToken(claims: Record<string, unknown>) {
  return new SignJWT({ id: 1, name: 'rea', ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(new TextEncoder().encode(TEST_SECRET))
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.authorization = ''
  Object.assign(mocks.user, { password: 'old-hash', status: 'ENABLE', tokenVersion: 0 })
  mocks.findUnique.mockImplementation(async () => ({ ...mocks.user }))
  mocks.findProfile.mockResolvedValue(null)
  mocks.update.mockImplementation(async ({ data }: {
    data: { tokenVersion: { increment: number }; password?: string }
  }) => {
    mocks.user.tokenVersion += data.tokenVersion.increment
    if (data.password) mocks.user.password = data.password
    return { ...mocks.user }
  })
  mocks.updateManyAndReturn.mockImplementation(async ({ where, data }: {
    where: { id: number; tokenVersion: number; status: string }
    data: { tokenVersion: { increment: number }; password: string }
  }) => {
    if (where.id !== mocks.user.id || where.tokenVersion !== mocks.user.tokenVersion
      || where.status !== mocks.user.status) return []
    mocks.user.tokenVersion += data.tokenVersion.increment
    mocks.user.password = data.password
    return [{ ...mocks.user }]
  })
  mocks.compare.mockResolvedValue(true)
  mocks.hash.mockResolvedValue('new-hash')
})

afterAll(() => vi.unstubAllEnvs())

describe('JWT session revocation', () => {
  it('propagates database failures through verification and session lookup', async () => {
    const token = await authorize()
    const cause = new Error('Pool unavailable')
    mocks.findUnique.mockRejectedValue(cause)

    await expect(verifyToken(token)).rejects.toMatchObject({ name: 'AuthInfrastructureError', cause })
    await expect(getSession()).rejects.toMatchObject({ name: 'AuthInfrastructureError', cause })
  })

  it.each([
    { name: 'refresh', invoke: () => refresh(request('auth/refresh')) },
    { name: 'scheme sync', invoke: () => getProfile() },
  ])('$name distinguishes database failures, revoked tokens and valid sessions', async ({ invoke }) => {
    await authorize()
    mocks.findUnique.mockRejectedValueOnce(new Error('Pool unavailable'))
    expect((await invoke()).status).toBe(503)

    mocks.user.tokenVersion = 1
    expect((await invoke()).status).toBe(401)

    await authorize()
    expect((await invoke()).status).toBe(200)
  })

  it.each([checkAdminPermission, checkRootAdminPermission])(
    '%s distinguishes database failures, revoked tokens and valid sessions', async checkPermission => {
      await authorize()
      mocks.findUnique.mockRejectedValueOnce(new Error('Pool unavailable'))
      const unavailable = await checkPermission()
      expect(unavailable.authorized).toBe(false)
      expect(unavailable.response?.status).toBe(503)

      mocks.user.tokenVersion = 1
      expect((await checkPermission()).response?.status).toBe(401)

      await authorize()
      expect((await checkPermission()).authorized).toBe(true)
    }
  )

  it('returns 503 when the second refresh lookup fails', async () => {
    await authorize()
    mocks.findUnique.mockResolvedValueOnce({ ...mocks.user })
      .mockRejectedValueOnce(new Error('Pool unavailable'))

    expect((await refresh(request('auth/refresh'))).status).toBe(503)
  })

  it('checks the current version with one indexed session lookup', async () => {
    mocks.user.tokenVersion = 3
    await authorize()

    expect(await getSession()).toMatchObject({ id: 1, tv: 3 })
    expect(mocks.findUnique).toHaveBeenCalledExactlyOnceWith({
      where: { id: 1 }, select: { status: true, tokenVersion: true },
    })
  })

  it('accepts a legacy token only until version zero is revoked', async () => {
    const token = await rawToken({})
    expect(await verifyToken(token)).toMatchObject({ id: 1, tv: 0 })

    mocks.user.tokenVersion = 1
    expect(await verifyToken(token)).toBeNull()
  })

  it.each([null, '0', -1])('rejects malformed token version %s before querying', async tv => {
    expect(await verifyToken(await rawToken({ tv }))).toBeNull()
    expect(mocks.findUnique).not.toHaveBeenCalled()
  })

  it('rejects invalid signatures, expired tokens and invalid identity claims before querying', async () => {
    const invalidSignature = await new SignJWT({ id: 1, name: 'rea', tv: 0 })
      .setProtectedHeader({ alg: 'HS256' })
      .sign(new TextEncoder().encode('different-test-secret'))
    const expired = await new SignJWT({ id: 1, name: 'rea', tv: 0 })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime(0)
      .sign(new TextEncoder().encode(TEST_SECRET))

    for (const token of [invalidSignature, expired, await rawToken({ id: '1' }), 'malformed']) {
      expect(await verifyToken(token)).toBeNull()
    }
    expect(mocks.findUnique).not.toHaveBeenCalled()
  })

  it.each(['DISABLE', 'BANNED'])('rejects a %s user', async status => {
    const token = await authorize()
    mocks.user.status = status
    expect(await verifyToken(token)).toBeNull()
    expect(await getSession()).toBeNull()
  })

  it('rejects a deleted user', async () => {
    const token = await authorize()
    mocks.findUnique.mockResolvedValue(null)
    expect(await verifyToken(token)).toBeNull()
  })

  it('revokes all existing tokens through logout-all', async () => {
    const token = await authorize()
    const response = await logoutAll()

    expect(response.status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 1 }, data: { tokenVersion: { increment: 1 } },
    }))
    expect(await verifyToken(token)).toBeNull()
    expect(await getSession()).toBeNull()
  })

  it('requires authentication before logout-all can revoke sessions', async () => {
    expect((await logoutAll()).status).toBe(401)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('atomically changes the password and revokes old tokens while issuing a usable token', async () => {
    const oldToken = await authorize()
    const response = await changePassword(request('user/change-password', {
      currentPassword: 'old-password', newPassword: 'new-password',
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.compare).toHaveBeenCalledWith('old-password', 'old-hash')
    expect(mocks.updateManyAndReturn).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 1, tokenVersion: 0, status: 'ENABLE' },
      data: { password: 'new-hash', tokenVersion: { increment: 1 } },
    }))
    expect(await verifyToken(oldToken)).toBeNull()
    expect(await verifyToken(body.token)).toMatchObject({ id: 1, tv: 1 })
  })

  it('does not revoke sessions when the current password is wrong', async () => {
    const token = await authorize()
    mocks.compare.mockResolvedValue(false)

    const response = await changePassword(request('user/change-password', {
      currentPassword: 'wrong-password', newPassword: 'new-password',
    }))

    expect(response.status).toBe(400)
    expect(mocks.updateManyAndReturn).not.toHaveBeenCalled()
    expect(await verifyToken(token)).toMatchObject({ tv: 0 })
  })

  it.each(['revocation', 'disable'])('rejects a password change racing with %s', async action => {
    await authorize()
    mocks.hash.mockImplementation(async () => {
      if (action === 'revocation') mocks.user.tokenVersion += 1
      else mocks.user.status = 'DISABLE'
      return 'new-hash'
    })

    const response = await changePassword(request('user/change-password', {
      currentPassword: 'old-password', newPassword: 'new-password',
    }))

    expect(response.status).toBe(401)
    expect(await response.json()).not.toHaveProperty('token')
    expect(mocks.user.password).toBe('old-hash')
    expect(mocks.user.tokenVersion).toBe(action === 'revocation' ? 1 : 0)
  })

  it('refuses to refresh a revoked token', async () => {
    await authorize()
    await logoutAll()

    const response = await refresh(request('auth/refresh'))
    expect(response.status).toBe(401)
    expect(await response.json()).not.toHaveProperty('token')
  })

  it('refreshes an active token with its current database version', async () => {
    mocks.user.tokenVersion = 4
    await authorize()

    const response = await refresh(request('auth/refresh'))
    expect(response.status).toBe(200)
    expect(await verifyToken((await response.json()).token)).toMatchObject({ tv: 4 })
  })

  it('does not reissue when revocation occurs between refresh lookups', async () => {
    await authorize()
    mocks.user.tokenVersion = 1
    mocks.findUnique.mockResolvedValueOnce({ status: 'ENABLE', tokenVersion: 0 })

    const response = await refresh(request('auth/refresh'))
    expect(response.status).toBe(401)
    expect(await response.json()).not.toHaveProperty('token')
  })
})
