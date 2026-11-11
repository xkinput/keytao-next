import { createHash, createHmac } from 'node:crypto'

export const PRESIGN_EXPIRY_SECONDS = 10 * 60

type SigningInput = {
  method: 'GET' | 'PUT' | 'HEAD' | 'DELETE'
  url: URL
  accessKeyId: string
  secretAccessKey: string
  region: string
  now?: Date
  expiresIn?: number
  headers?: Record<string, string>
}

function encode(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}

export function presignS3Url(input: SigningInput): string {
  const url = new URL(input.url)
  const expiresIn = input.expiresIn ?? PRESIGN_EXPIRY_SECONDS
  if (!Number.isSafeInteger(expiresIn) || expiresIn < 1 || expiresIn > 604800) {
    throw new Error('Invalid object URL expiration')
  }
  const timestamp = (input.now ?? new Date()).toISOString().replace(/[:-]|\.\d{3}/g, '')
  const date = timestamp.slice(0, 8)
  const scope = `${date}/${input.region}/s3/aws4_request`
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(input.headers ?? {})) {
    headers[name.toLowerCase()] = value.trim().replace(/\s+/g, ' ')
  }
  headers.host = url.host
  const headerNames = Object.keys(headers).sort()
  const signedHeaders = headerNames.join(';')
  const canonicalHeaders = headerNames.map(name => `${name}:${headers[name]}\n`).join('')
  url.searchParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256')
  url.searchParams.set('X-Amz-Credential', `${input.accessKeyId}/${scope}`)
  url.searchParams.set('X-Amz-Date', timestamp)
  url.searchParams.set('X-Amz-Expires', String(expiresIn))
  url.searchParams.set('X-Amz-SignedHeaders', signedHeaders)
  const canonicalQuery = [...url.searchParams.entries()]
    .map(([name, value]) => `${encode(name)}=${encode(value)}`)
    .sort()
    .join('&')
  const canonicalRequest = [input.method, url.pathname, canonicalQuery, canonicalHeaders, signedHeaders, 'UNSIGNED-PAYLOAD'].join('\n')
  const stringToSign = ['AWS4-HMAC-SHA256', timestamp, scope, createHash('sha256').update(canonicalRequest).digest('hex')].join('\n')
  const dateKey = createHmac('sha256', `AWS4${input.secretAccessKey}`).update(date).digest()
  const regionKey = createHmac('sha256', dateKey).update(input.region).digest()
  const serviceKey = createHmac('sha256', regionKey).update('s3').digest()
  const signingKey = createHmac('sha256', serviceKey).update('aws4_request').digest()
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')
  url.search = `${canonicalQuery}&X-Amz-Signature=${signature}`
  return url.toString()
}

function storageConfig() {
  const endpoint = process.env.S3_ENDPOINT?.trim()
  const bucket = process.env.S3_BUCKET?.trim()
  const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim()
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim()
  const region = process.env.S3_REGION?.trim() || 'auto'
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error('Object storage is not configured')
  }
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    throw new Error('Object storage is not configured')
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Object storage is not configured')
  }
  return { url, bucket, accessKeyId, secretAccessKey, region }
}

export function isObjectStorageConfigured(): boolean {
  try {
    storageConfig()
    return true
  } catch {
    return false
  }
}

function objectUrl(key: string) {
  const config = storageConfig()
  config.url.pathname = `${config.url.pathname.replace(/\/$/, '')}/${encode(config.bucket)}/${key.split('/').map(encode).join('/')}`
  return config
}

export function presignPut(key: string, { contentLength, sha256 }: { contentLength: number; sha256: string }) {
  if (!Number.isSafeInteger(contentLength) || contentLength < 1 || !/^[a-f0-9]{64}$/i.test(sha256)) {
    throw new Error('Invalid object upload metadata')
  }
  const config = objectUrl(key)
  // R2 checksum support is not assumed; the signed length binds the upload size.
  const headers = { 'Content-Length': String(contentLength) }
  return { url: presignS3Url({ ...config, method: 'PUT', headers }), headers }
}

export function presignGet(key: string, filename: string): string {
  const config = objectUrl(key)
  const safeFilename = filename.replace(/[\u0000-\u001f\u007f]/g, '')
  const fallback = safeFilename.replace(/[^\x20-\x7e]|["\\]/g, '_')
  config.url.searchParams.set('response-content-disposition', `attachment; filename="${fallback}"; filename*=UTF-8''${encode(safeFilename)}`)
  return presignS3Url({ ...config, method: 'GET' })
}

async function objectRequest(key: string, method: 'HEAD' | 'DELETE') {
  const config = objectUrl(key)
  const url = presignS3Url({ ...config, method })
  const response = await fetch(url, { method, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(5_000) })
  if (!response.ok && response.status !== 404) {
    throw new Error(`Object storage ${method} failed (${response.status})`)
  }
  return response
}

export async function headObject(key: string): Promise<{ size: number } | null> {
  const response = await objectRequest(key, 'HEAD')
  if (response.status === 404) return null
  const length = response.headers.get('content-length')
  const size = Number(length)
  if (length === null || !/^\d+$/.test(length) || !Number.isSafeInteger(size)) {
    throw new Error('Object storage returned an invalid size')
  }
  return { size }
}

export async function deleteObject(key: string): Promise<void> {
  await objectRequest(key, 'DELETE')
}
