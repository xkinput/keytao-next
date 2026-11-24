// @vitest-environment node
import { runInNewContext } from 'node:vm'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authorization: '',
  user: { id: 1, name: 'test', nickname: '</script><script>throw 1</script>', status: 'ENABLE', tokenVersion: 3 },
  findUnique: vi.fn(),
}))

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ authorization: mocks.authorization }),
}))
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: mocks.findUnique } } }))
vi.mock('@/lib/rateLimit', () => ({
  checkRateLimit: () => ({ allowed: true, retryAfterMs: 0 }),
}))

vi.stubEnv('JWT_SECRET', 'webview-session-test-secret')
const { signToken, verifyToken } = await import('@/lib/auth')
const { GET, POST } = await import('./route')
const { POST: refresh } = await import('../refresh/route')

const canonicalOrigin = 'https://keytao.rea.ink'
const alternateOrigin = 'https://keytao.vercel.app'
const route = '/api/auth/app-webview-session'
const ownerKey = 'keytao-app-webview-session'

function issue(origin: string) {
  return POST(new NextRequest(canonicalOrigin + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ origin }),
  }))
}

function redeem(origin: string, grant: string) {
  return GET(new NextRequest(origin + route, { headers: { 'X-KeyTao-App-Session': grant } }))
}

async function authorize() {
  const token = await signToken({ id: mocks.user.id, name: mocks.user.name, tv: mocks.user.tokenVersion })
  mocks.authorization = `Bearer ${token}`
  return token
}

async function runBootstrap(response: Response, storage: Map<string, string>) {
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(response.headers.get('Referrer-Policy')).toBe('no-referrer')
  expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
  const html = await response.text()
  const script = html.match(/<script nonce="([^"]+)">([\s\S]*)<\/script>$/)
  expect(script).not.toBeNull()
  expect(response.headers.get('Content-Security-Policy')).toContain(`script-src 'nonce-${script?.[1]}'`)
  const replace = vi.fn()
  runInNewContext(script![2], {
    atob,
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
    location: { replace },
  })
  expect(replace).toHaveBeenCalledExactlyOnceWith('/')
  return html
}

beforeEach(() => {
  mocks.authorization = ''
  mocks.user.status = 'ENABLE'
  mocks.user.tokenVersion = 3
  mocks.findUnique.mockReset().mockImplementation(async () => ({ ...mocks.user }))
})

afterEach(() => vi.useRealTimers())

describe('App WebView session', () => {
  it('requires an authenticated App account and exactly allowlisted origin', async () => {
    expect((await issue(canonicalOrigin)).status).toBe(401)
    await authorize()
    for (const origin of ['http://keytao.rea.ink', canonicalOrigin + '/', 'https://keytao.vercel.app.example.com']) {
      expect((await issue(origin)).status).toBe(400)
    }
  })

  it('bounds a grant to its site, purpose, account version and expiration', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const issuedAt = Date.now()
    const appToken = await authorize()
    const response = await issue(alternateOrigin)
    expect(response.status).toBe(200)
    const { grant } = await response.json()
    expect(await verifyToken(grant)).toBeNull()
    expect((await redeem(canonicalOrigin, grant)).status).toBe(401)
    expect((await redeem(alternateOrigin, appToken)).status).toBe(401)
    mocks.user.tokenVersion++
    expect((await redeem(alternateOrigin, grant)).status).toBe(401)
    mocks.user.tokenVersion--
    mocks.user.status = 'DISABLE'
    expect((await redeem(alternateOrigin, grant)).status).toBe(401)
    mocks.user.status = 'ENABLE'
    vi.setSystemTime(issuedAt + 61_000)
    expect((await redeem(alternateOrigin, grant)).status).toBe(401)
  })

  it('does not navigate to the website when session storage is unavailable', async () => {
    await authorize()
    const { grant } = await (await issue(alternateOrigin)).json()
    const response = await redeem(alternateOrigin, grant)
    const script = (await response.text()).match(/<script nonce="[^"]+">([\s\S]*)<\/script>$/)
    expect(script).not.toBeNull()
    const replace = vi.fn()
    const setItem = vi.fn(() => { throw new Error('Storage unavailable') })
    expect(() => runInNewContext(script![1], { localStorage: { setItem }, location: { replace } }))
      .toThrow('Storage unavailable')
    expect(replace).not.toHaveBeenCalled()
  })

  it('bootstraps a distinct web JWT, preserves its ownership across refresh and clears only that session', async () => {
    const appToken = await authorize()
    const { grant } = await (await issue(alternateOrigin)).json()
    const storage = new Map([['unrelated', 'keep']])
    const html = await runBootstrap(await redeem(alternateOrigin, grant), storage)
    expect(html).not.toContain(appToken)
    expect(html).not.toContain(grant)
    expect(html.match(/<\/script>/g)).toHaveLength(1)

    const persisted = JSON.parse(storage.get('auth-storage')!)
    const owner = JSON.parse(storage.get(ownerKey)!)
    expect(persisted.state.user).toEqual({
      id: mocks.user.id, name: mocks.user.name, nickname: mocks.user.nickname,
    })
    expect(persisted.state.token).not.toBe(appToken)
    expect(await verifyToken(persisted.state.token)).toMatchObject({ id: mocks.user.id, jti: owner.jti })
    const refreshed = await refresh(new NextRequest(alternateOrigin + '/api/auth/refresh', {
      method: 'POST',
      headers: { Authorization: `Bearer ${persisted.state.token}` },
    }))
    expect(refreshed.status).toBe(200)
    persisted.state.token = (await refreshed.json()).token
    expect(await verifyToken(persisted.state.token)).toMatchObject({ id: mocks.user.id, jti: owner.jti })
    storage.set('auth-storage', JSON.stringify(persisted))
    await runBootstrap(await redeem(alternateOrigin, 'clear'), storage)
    expect([...storage]).toEqual([['unrelated', 'keep']])

    storage.set(ownerKey, JSON.stringify(owner))
    persisted.state.token = appToken
    const manualSession = JSON.stringify(persisted)
    storage.set('auth-storage', manualSession)
    await runBootstrap(await redeem(alternateOrigin, 'clear'), storage)
    expect(storage.has(ownerKey)).toBe(false)
    expect(storage.get('auth-storage')).toBe(manualSession)
  })
})
