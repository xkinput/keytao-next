import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteObject, headObject, isObjectStorageConfigured, presignGet, presignPut } from './objectStorage'
import { signToken, verifyToken } from '../workers/scheme-files/src/token'

const key = 'scheme-packages/7/12345678-1234-1234-1234-123456789abc.zip'
const sha256 = 'a'.repeat(64)
const secret = 'test-files-signing-secret'
const nowSeconds = 1794355200
const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubEnv('FILES_BASE_URL', 'https://files.example.test')
  vi.stubEnv('FILES_SIGNING_SECRET', secret)
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-11T00:00:00.000Z'))
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('object storage signing', () => {
  it('signs uploads that the Worker verifies with the same ten-minute token', async () => {
    const result = presignPut(key, { contentLength: 123, sha256 })
    const url = new URL(result.url)
    const payload = { op: 'put' as const, key, size: 123, sha256, exp: nowSeconds + 600 }

    expect(url.origin).toBe('https://files.example.test')
    expect(url.pathname).toBe(`/u/${await signToken(payload, secret)}`)
    await expect(verifyToken(url.pathname.slice(3), secret, 'put', nowSeconds)).resolves.toEqual(payload)
    expect(result.headers).toEqual({ 'Content-Length': '123', 'Content-Type': 'application/zip' })
  })

  it('signs attachment downloads for the Worker', async () => {
    const filename = '方案.zip'
    const url = new URL(presignGet(key, filename))
    const payload = { op: 'get' as const, key, filename, exp: nowSeconds + 600 }

    expect(url.origin).toBe('https://files.example.test')
    expect(url.pathname).toBe(`/d/${await signToken(payload, secret)}`)
    await expect(verifyToken(url.pathname.slice(3), secret, 'get', nowSeconds)).resolves.toEqual(payload)
  })

  it('uses the custom files domain by default', () => {
    vi.stubEnv('FILES_BASE_URL', '')

    expect(new URL(presignGet(key, 'scheme.zip')).origin).toBe('https://files.keytao.rea.ink')
  })

  it('preserves the shared signing secret bytes', async () => {
    const exactSecret = ` ${secret}\n`
    vi.stubEnv('FILES_SIGNING_SECRET', exactSecret)
    const url = new URL(presignGet(key, 'scheme.zip'))

    await expect(verifyToken(url.pathname.slice(3), exactSecret, 'get', nowSeconds))
      .resolves.toEqual({ op: 'get', key, filename: 'scheme.zip', exp: nowSeconds + 600 })
  })

  it('requires only the files signing secret and refuses to sign when it is missing', () => {
    expect(isObjectStorageConfigured()).toBe(true)
    vi.stubEnv('FILES_SIGNING_SECRET', '')

    expect(isObjectStorageConfigured()).toBe(false)
    expect(() => presignGet(key, 'scheme.zip')).toThrow('Object storage is not configured')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    'https://user:password@files.example.test',
    'https://files.example.test?query=value',
    'https://files.example.test#fragment',
    'https://files.example.test/path',
    'file:///tmp/files',
    'invalid-url',
  ])('rejects unsafe files base URLs: %s', (baseUrl) => {
    expect(isObjectStorageConfigured()).toBe(true)
    vi.stubEnv('FILES_BASE_URL', baseUrl)

    expect(isObjectStorageConfigured()).toBe(false)
    expect(() => presignGet(key, 'scheme.zip')).toThrow('Object storage is not configured')
  })
})

describe('object storage requests', () => {
  it('returns verified size and sha256 from an authorized Worker head request', async () => {
    fetchMock.mockResolvedValue(Response.json({ size: 321, sha256 }))

    await expect(headObject(key)).resolves.toEqual({ size: 321, sha256 })
    const [url, options] = fetchMock.mock.calls[0]
    expect(options).toEqual(expect.objectContaining({ method: 'POST', redirect: 'error', cache: 'no-store' }))
    expect(url).toMatch(/^https:\/\/files\.example\.test\/internal\/head\//)
    await expect(verifyToken(new URL(url).pathname.split('/').at(-1)!, secret, 'head', nowSeconds))
      .resolves.toEqual({ op: 'head', key, exp: nowSeconds + 600 })
  })

  it('returns null only for a missing object', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }))
    await expect(headObject(key)).resolves.toBeNull()

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 403 }))
    await expect(headObject(key)).rejects.toThrow('Object storage HEAD failed (403)')
  })

  it.each([
    null,
    { size: '321', sha256 },
    { size: -1, sha256 },
    { size: 1.5, sha256 },
    { size: 321 },
    { size: 321, sha256: 'invalid' },
  ])('rejects invalid Worker object metadata: %j', async (metadata) => {
    fetchMock.mockResolvedValue(Response.json(metadata))

    await expect(headObject(key)).rejects.toThrow('Object storage returned invalid metadata')
  })

  it('deletes through an authorized Worker request and treats a missing object as deleted', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await expect(deleteObject(key)).resolves.toBeUndefined()
    const [url, options] = fetchMock.mock.calls[0]
    expect(options).toEqual(expect.objectContaining({ method: 'POST', redirect: 'error', cache: 'no-store' }))
    expect(url).toMatch(/^https:\/\/files\.example\.test\/internal\/delete\//)
    await expect(verifyToken(new URL(url).pathname.split('/').at(-1)!, secret, 'delete', nowSeconds))
      .resolves.toEqual({ op: 'delete', key, exp: nowSeconds + 600 })

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }))
    await expect(deleteObject(key)).resolves.toBeUndefined()

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }))
    await expect(deleteObject(key)).rejects.toThrow('Object storage DELETE failed (500)')
  })
})
