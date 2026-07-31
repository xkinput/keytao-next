import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash, createHmac } from 'crypto'
import { NextRequest } from 'next/server'

const mockGetSession = vi.fn()
const mockCheckRateLimit = vi.fn()
vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))
vi.mock('@/lib/rateLimit', () => ({ checkRateLimit: mockCheckRateLimit }))

function request(body: unknown, method = 'POST') {
  return new NextRequest('http://localhost/api/bot/chat', {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.BOT_IDENTITY_SECRET = 'shared-test-secret'
  delete process.env.BOT_API_TOKEN
  mockGetSession.mockResolvedValue({ id: 42 })
  mockCheckRateLimit.mockReturnValue({ allowed: true, retryAfterMs: 0 })
  vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200, json: async () => ({ ok: true }) })))
})

describe('web bot identity signing', () => {
  it.each([
    ['POST', '/api/chat', async () => (await import('./route')).POST(request({ message: 'hi', session_id: 's1' }))],
    ['DELETE', '/api/chat/history', async () => (await import('./route')).DELETE(request({ session_id: 's1' }, 'DELETE'))],
  ])('binds %s identity to the actual upstream path', async (method, path, invoke) => {
    expect((await invoke()).status).toBe(200)
    const call = vi.mocked(fetch).mock.calls[0]
    const headers = call[1]?.headers as Record<string, string>
    expect(new URL(String(call[0])).pathname).toBe(path)
    expect(headers['X-Web-User-Id']).toBe('42')
    expect(headers['X-Web-User-Nonce']).toMatch(/^[a-f0-9]{32}$/)
    const rawBody = String(call[1]?.body)
    const bodySha256 = createHash('sha256').update(rawBody).digest('hex')
    expect(headers['X-Web-User-Sig']).toBe(
      createHmac('sha256', 'shared-test-secret')
        .update([
          method,
          path,
          '42',
          headers['X-Web-User-Ts'],
          headers['X-Web-User-Nonce'],
          bodySha256,
        ].join('\n'))
        .digest('hex')
    )
  })

  it('fails closed instead of proxying an unsigned identity', async () => {
    delete process.env.BOT_IDENTITY_SECRET
    const { POST } = await import('./route')
    expect((await POST(request({ message: 'hi', session_id: 's1' }))).status).toBe(500)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not fall back to BOT_API_TOKEN for identity signing', async () => {
    delete process.env.BOT_IDENTITY_SECRET
    process.env.BOT_API_TOKEN = 'legacy-token-must-not-sign-identity'
    const { POST } = await import('./route')
    expect((await POST(request({ message: 'hi', session_id: 's1' }))).status).toBe(500)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects extra keys and oversized messages before proxying', async () => {
    const { POST } = await import('./route')
    expect((await POST(request({ message: 'hi', session_id: 's1', user_id: 'evil' }))).status).toBe(400)
    expect((await POST(request({ message: 'x'.repeat(8001), session_id: 's1' }))).status).toBe(400)
    expect(fetch).not.toHaveBeenCalled()
  })
})
