import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteObject, headObject, isObjectStorageConfigured, presignGet, presignPut, presignS3Url } from './objectStorage'

const sha256 = 'a'.repeat(64)
const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubEnv('S3_ENDPOINT', 'https://storage.example.test')
  vi.stubEnv('S3_BUCKET', 'scheme-bucket')
  vi.stubEnv('S3_ACCESS_KEY_ID', 'test-access-key')
  vi.stubEnv('S3_SECRET_ACCESS_KEY', 'test-secret-key')
  vi.stubEnv('S3_REGION', '')
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
  it('matches the official AWS S3 presigned GET example', () => {
    const url = new URL(presignS3Url({
      method: 'GET',
      url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1',
      now: new Date('2013-05-24T00:00:00.000Z'),
      expiresIn: 86400,
    }))

    expect(url.searchParams.get('X-Amz-Signature')).toBe('aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404')
  })

  it('signs the upload length and uses a path-style URL expiring in ten minutes', () => {
    const result = presignPut('scheme-packages/1/a b.zip', { contentLength: 123, sha256 })
    const url = new URL(result.url)

    expect(url.origin).toBe('https://storage.example.test')
    expect(url.pathname).toBe('/scheme-bucket/scheme-packages/1/a%20b.zip')
    expect(url.searchParams.get('X-Amz-Expires')).toBe('600')
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;host')
    expect(url.searchParams.get('X-Amz-Credential')).toContain('/auto/s3/aws4_request')
    expect(result.headers).toEqual({ 'Content-Length': '123' })
    expect(presignPut('scheme-packages/1/a b.zip', { contentLength: 124, sha256 }).url).not.toBe(result.url)
  })

  it('includes a safely escaped attachment filename in the signed download URL', () => {
    const url = new URL(presignGet('scheme-packages/1/a.zip', '方案"\r\n.zip'))

    expect(url.searchParams.get('response-content-disposition')).toBe('attachment; filename="___.zip"; filename*=UTF-8\'\'%E6%96%B9%E6%A1%88%22.zip')
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host')
    expect(url.searchParams.get('X-Amz-Expires')).toBe('600')
  })

  it('detects missing configuration and refuses to sign', () => {
    vi.stubEnv('S3_SECRET_ACCESS_KEY', '')

    expect(isObjectStorageConfigured()).toBe(false)
    expect(() => presignGet('a.zip', 'a.zip')).toThrow('Object storage is not configured')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('object storage requests', () => {
  it('returns the object length from a signed HEAD request', async () => {
    fetchMock.mockResolvedValue(new Response(null, { headers: { 'Content-Length': '321' } }))

    await expect(headObject('scheme-packages/1/a.zip')).resolves.toEqual({ size: 321 })
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/scheme-bucket/scheme-packages/1/a.zip?'), expect.objectContaining({ method: 'HEAD', redirect: 'error' }))
  })

  it('returns null only for a missing object', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }))
    await expect(headObject('a.zip')).resolves.toBeNull()

    fetchMock.mockResolvedValue(new Response(null, { status: 403 }))
    await expect(headObject('a.zip')).rejects.toThrow('Object storage HEAD failed (403)')
  })

  it.each([null, 'invalid', '-1', '1.5'])('rejects an invalid HEAD object length: %s', async (length) => {
    fetchMock.mockResolvedValue(new Response(null, { headers: length === null ? {} : { 'Content-Length': length } }))

    await expect(headObject('a.zip')).rejects.toThrow('Object storage returned an invalid size')
  })

  it('deletes an object and treats a missing object as already deleted', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await expect(deleteObject('a.zip')).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: 'DELETE', redirect: 'error' }))

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }))
    await expect(deleteObject('a.zip')).resolves.toBeUndefined()

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }))
    await expect(deleteObject('a.zip')).rejects.toThrow('Object storage DELETE failed (500)')
  })
})
