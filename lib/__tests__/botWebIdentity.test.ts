import { createHash, createHmac } from 'crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BotIdentityConfigError,
  buildWebUserIdentityHeaders,
  signWebUserIdentity,
} from '@/lib/botWebIdentity'

const ORIGINAL_SECRET = process.env.BOT_IDENTITY_SECRET
const NOW = new Date('2026-07-26T12:00:00.000Z')
const TS = String(Math.floor(NOW.getTime() / 1000))
const RAW_BODY = JSON.stringify({ message: 'hello' })
const BODY_SHA256 = createHash('sha256').update(RAW_BODY).digest('hex')
const BASE_SIGNATURE_INPUT = {
  userId: 42,
  method: 'POST',
  path: '/api/chat',
  timestamp: TS,
  nonce: '00112233445566778899aabbccddeeff',
  bodySha256: BODY_SHA256,
}

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) {
    delete process.env.BOT_IDENTITY_SECRET
  } else {
    process.env.BOT_IDENTITY_SECRET = ORIGINAL_SECRET
  }
  vi.restoreAllMocks()
})

describe('buildWebUserIdentityHeaders', () => {
  it('signs method, path, user, timestamp, nonce, and body hash', () => {
    process.env.BOT_IDENTITY_SECRET = 'shared-secret'

    const headers = buildWebUserIdentityHeaders(
      { userId: 42, method: 'POST', path: '/api/chat', rawBody: RAW_BODY },
      NOW
    )
    const nonce = headers['X-Web-User-Nonce']

    expect(headers['X-Web-User-Id']).toBe('42')
    expect(headers['X-Web-User-Ts']).toBe(TS)
    expect(nonce).toMatch(/^[0-9a-f]{32}$/)
    expect(headers['X-Web-User-Sig']).toBe(
      createHmac('sha256', 'shared-secret')
        .update(['POST', '/api/chat', '42', TS, nonce, BODY_SHA256].join('\n'))
        .digest('hex')
    )
    expect(headers['X-Web-User-Sig']).toMatch(/^[0-9a-f]{64}$/)
  })

  it('produces a timestamp in seconds, not milliseconds', () => {
    process.env.BOT_IDENTITY_SECRET = 'shared-secret'

    const headers = buildWebUserIdentityHeaders(
      { userId: 1, method: 'POST', path: '/api/chat', rawBody: '' },
      NOW
    )

    expect(Number(headers['X-Web-User-Ts'])).toBe(Math.floor(NOW.getTime() / 1000))
    expect(headers['X-Web-User-Ts']).toHaveLength(10)
  })

  it('fails fast instead of proxying an unsigned request when the secret is missing', () => {
    delete process.env.BOT_IDENTITY_SECRET

    expect(() =>
      buildWebUserIdentityHeaders({
        userId: 42,
        method: 'POST',
        path: '/api/chat',
        rawBody: RAW_BODY,
      })
    ).toThrow(BotIdentityConfigError)
  })
})

describe('signWebUserIdentity', () => {
  it('is stable for the same canonical inputs', () => {
    expect(signWebUserIdentity('k', BASE_SIGNATURE_INPUT)).toBe(
      signWebUserIdentity('k', { ...BASE_SIGNATURE_INPUT, timestamp: Number(TS) })
    )
  })

  it('normalizes the method to uppercase', () => {
    expect(signWebUserIdentity('k', { ...BASE_SIGNATURE_INPUT, method: 'post' })).toBe(
      signWebUserIdentity('k', BASE_SIGNATURE_INPUT)
    )
  })

  it('binds signatures independently to user, method, path, body, and nonce', () => {
    const original = signWebUserIdentity('k', BASE_SIGNATURE_INPUT)

    expect(signWebUserIdentity('k', { ...BASE_SIGNATURE_INPUT, userId: 43 })).not.toBe(original)
    expect(signWebUserIdentity('k', { ...BASE_SIGNATURE_INPUT, method: 'DELETE' })).not.toBe(original)
    expect(signWebUserIdentity('k', { ...BASE_SIGNATURE_INPUT, path: '/api/chat/history' })).not.toBe(original)
    expect(signWebUserIdentity('k', { ...BASE_SIGNATURE_INPUT, bodySha256: '0'.repeat(64) })).not.toBe(original)
    expect(signWebUserIdentity('k', { ...BASE_SIGNATURE_INPUT, nonce: 'f'.repeat(32) })).not.toBe(original)
  })

  it('matches the documented newline-delimited message layout exactly', () => {
    expect(signWebUserIdentity('shared-secret', BASE_SIGNATURE_INPUT)).toBe(
      createHmac('sha256', 'shared-secret')
        .update(['POST', '/api/chat', '42', TS, BASE_SIGNATURE_INPUT.nonce, BODY_SHA256].join('\n'))
        .digest('hex')
    )
  })
})
