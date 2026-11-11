import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker, { type Env } from './index'
import { signToken, type FileToken } from './token'

const key = 'scheme-packages/7/12345678-1234-1234-1234-123456789abc.zip'
const secret = 'unit-test-files-secret'
const sha256 = 'a'.repeat(64)
const checksum = new Uint8Array(32).fill(0xaa).buffer
const metadata = { size: 3, checksums: { sha256: checksum } }
const putClaims: FileToken = { op: 'put', key, size: 3, sha256, exp: 1_794_355_800 }
const bucket = { head: vi.fn(), get: vi.fn(), put: vi.fn(), delete: vi.fn() }
const env: Env = { FILES_SIGNING_SECRET: secret, BUCKET: bucket }

async function upload(headers: Record<string, string> = { 'Content-Length': '3' }) {
  const token = await signToken(putClaims, secret)
  return new Request(`https://files.keytao.rea.ink/u/${token}`, { method: 'PUT', body: 'zip', headers })
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-11T00:00:00Z'))
  bucket.head.mockResolvedValue(null)
  bucket.put.mockResolvedValue(metadata)
})

afterEach(() => vi.useRealTimers())

describe('scheme files Worker', () => {
  it('streams an exact-size upload to R2 with its declared checksum', async () => {
    const request = await upload()
    const response = await worker.fetch(request, env)
    expect(response.status).toBe(201)
    expect(bucket.put).toHaveBeenCalledWith(key, request.body, expect.objectContaining({
      sha256,
      httpMetadata: { contentType: 'application/zip' },
    }))
  })

  it.each([
    ['missing length', {}],
    ['size mismatch', { 'Content-Length': '4' }],
    ['chunked body', { 'Content-Length': '3', 'Transfer-Encoding': 'chunked' }],
  ])('rejects uploads with %s', async (_name, headers) => {
    const response = await worker.fetch(await upload(headers as Record<string, string>), env)
    expect(response.status).toBe(400)
    expect(bucket.put).not.toHaveBeenCalled()
  })

  it('refuses to overwrite an existing key', async () => {
    bucket.head.mockResolvedValue(metadata)
    const response = await worker.fetch(await upload(), env)
    expect(response.status).toBe(409)
    expect(bucket.put).not.toHaveBeenCalled()
  })

  it('refuses a concurrent overwrite using an atomic R2 precondition', async () => {
    bucket.put.mockResolvedValue(null)
    const request = await upload()
    const response = await worker.fetch(request, env)
    expect(response.status).toBe(409)
    expect(bucket.put).toHaveBeenCalledWith(key, request.body, expect.objectContaining({
      onlyIf: { etagDoesNotMatch: '*' },
    }))
  })

  it('streams downloads with a safe attachment filename and returns 404 when missing', async () => {
    bucket.get.mockImplementation(async () => ({ ...metadata, body: new Response('zip').body! }))
    const token = await signToken({ op: 'get', key, filename: '方案"\r\n.zip', exp: putClaims.exp }, secret)
    const request = new Request(`https://files.keytao.rea.ink/d/${token}`)
    const response = await worker.fetch(request, env)
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/zip')
    expect(response.headers.get('Content-Length')).toBe('3')
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="___.zip"; filename*=UTF-8\'\'%E6%96%B9%E6%A1%88%22.zip')
    expect(await response.text()).toBe('zip')
    bucket.get.mockResolvedValue(null)
    expect((await worker.fetch(request, env)).status).toBe(404)
  })

  it('returns R2 checksum metadata through authorized head and 404 when missing', async () => {
    bucket.head.mockResolvedValue(metadata)
    const token = await signToken({ op: 'head', key, exp: putClaims.exp }, secret)
    const request = new Request(`https://files.keytao.rea.ink/internal/head/${token}`, { method: 'POST' })
    const response = await worker.fetch(request, env)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ size: 3, sha256 })
    bucket.head.mockResolvedValue(null)
    expect((await worker.fetch(request, env)).status).toBe(404)
  })

  it('deletes idempotently through an authorized internal request', async () => {
    const token = await signToken({ op: 'delete', key, exp: putClaims.exp }, secret)
    const request = new Request(`https://files.keytao.rea.ink/internal/delete/${token}`, { method: 'POST' })
    expect((await worker.fetch(request, env)).status).toBe(204)
    expect((await worker.fetch(request, env)).status).toBe(204)
    expect(bucket.delete).toHaveBeenCalledWith(key)
  })

  it.each([
    ['GET', '/d/invalid'], ['POST', '/internal/head/invalid'], ['POST', '/internal/delete/invalid'],
  ])('denies unauthorized %s %s before reading storage', async (method, path) => {
    const response = await worker.fetch(new Request(`https://files.keytao.rea.ink${path}`, { method }), env)
    expect(response.status).toBe(403)
    expect(bucket.head).not.toHaveBeenCalled()
    expect(bucket.get).not.toHaveBeenCalled()
    expect(bucket.put).not.toHaveBeenCalled()
    expect(bucket.delete).not.toHaveBeenCalled()
  })

  it('fails closed when the signing secret is missing', async () => {
    const request = await upload()
    expect((await worker.fetch(request, { ...env, FILES_SIGNING_SECRET: ' ' })).status).toBe(503)
    expect(bucket.put).not.toHaveBeenCalled()
  })
})
