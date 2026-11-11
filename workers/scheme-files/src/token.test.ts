import { describe, expect, it } from 'vitest'
import { createHmac } from 'node:crypto'
import { signToken, verifyToken, type FileToken } from './token'

const secret = 'unit-test-files-secret'
const now = 1_794_355_200
const key = 'scheme-packages/7/12345678-1234-1234-1234-123456789abc.zip'
const payload: FileToken = { op: 'put', key, size: 3, sha256: 'a'.repeat(64), exp: now + 600 }

describe('file authorization tokens', () => {
  it('round trips a signed upload token through the Worker verifier', async () => {
    const token = await signToken(payload, secret)
    expect(await verifyToken(token, secret, 'put', now)).toEqual(payload)
  })

  it('rejects expired tokens including the exact expiration second', async () => {
    const token = await signToken({ ...payload, exp: now }, secret)
    expect(await verifyToken(token, secret, 'put', now)).toBeNull()
  })

  it('rejects a token issued for another operation', async () => {
    const token = await signToken(payload, secret)
    expect(await verifyToken(token, secret, 'delete', now)).toBeNull()
  })

  it('rejects a token with a tampered signature', async () => {
    const token = await signToken(payload, secret)
    const tampered = `${token.slice(0, -1)}${token.endsWith('0') ? '1' : '0'}`
    expect(await verifyToken(tampered, secret, 'put', now)).toBeNull()
  })

  it.each([
    { ...payload, key: 'scheme-packages/7/../secret.zip' },
    { ...payload, key: 'other/7/12345678-1234-1234-1234-123456789abc.zip' },
    { ...payload, exp: now + 0.5 },
    { ...payload, size: 0 },
    { ...payload, size: 1.5 },
    { ...payload, sha256: 'invalid' },
  ])('rejects signed invalid claims: %j', async claims => {
    const encoded = Buffer.from(JSON.stringify(claims)).toString('base64url')
    const signature = createHmac('sha256', secret).update(encoded).digest('hex')
    expect(await verifyToken(`${encoded}.${signature}`, secret, 'put', now)).toBeNull()
  })

  it.each(['', 'malformed'])(
    'rejects malformed tokens without throwing: %s', async token => {
      expect(await verifyToken(token, secret, 'put', now)).toBeNull()
    },
  )
})
