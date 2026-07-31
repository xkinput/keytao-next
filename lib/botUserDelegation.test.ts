import { createHash, createHmac } from 'crypto'
import { describe, expect, it } from 'vitest'
import { verifyWebBotDelegation } from './botUserDelegation'

function signedRequest(rawBody: string, nonce: string) {
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const canonical = [
    'POST', '/api/bot/batches/batch-1/submit', 'web', '42', timestamp, nonce,
    createHash('sha256').update(rawBody).digest('hex'),
  ].join('\n')
  const signature = createHmac('sha256', 'delegation-secret').update(canonical).digest('hex')
  return new Request('http://localhost/api/bot/batches/batch-1/submit', {
    method: 'POST',
    headers: {
      'X-Bot-User-Ts': timestamp,
      'X-Bot-User-Nonce': nonce,
      'X-Bot-User-Sig': signature,
    },
    body: rawBody,
  })
}

describe('web bot delegation', () => {
  it('binds method, path, user, nonce, and raw body and rejects replay', () => {
    process.env.BOT_IDENTITY_SECRET = 'delegation-secret'
    const rawBody = '{"platform":"web","platformId":"42"}'
    const request = signedRequest(rawBody, '0123456789abcdef0123456789abcdef')

    expect(verifyWebBotDelegation(request, 'web', '42', rawBody)).toBe(true)
    expect(verifyWebBotDelegation(request, 'web', '42', rawBody)).toBe(false)
  })

  it('rejects a valid signature when the body changes', () => {
    process.env.BOT_IDENTITY_SECRET = 'delegation-secret'
    const rawBody = '{"platform":"web","platformId":"42"}'
    const request = signedRequest(rawBody, 'fedcba9876543210fedcba9876543210')

    expect(verifyWebBotDelegation(request, 'web', '42', rawBody + ' ')).toBe(false)
  })

  it('does not accept BOT_API_TOKEN as a delegation secret', () => {
    delete process.env.BOT_IDENTITY_SECRET
    process.env.BOT_API_TOKEN = 'delegation-secret'
    const rawBody = '{"platform":"web","platformId":"42"}'
    const request = signedRequest(rawBody, '00112233445566778899aabbccddeeff')

    expect(verifyWebBotDelegation(request, 'web', '42', rawBody)).toBe(false)
  })
})
