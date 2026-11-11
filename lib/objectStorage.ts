import { createHmac } from 'node:crypto'
import { encodeTokenPayload, type FileToken } from '../workers/scheme-files/src/token'

export const PRESIGN_EXPIRY_SECONDS = 10 * 60

function storageConfig() {
  const secret = process.env.FILES_SIGNING_SECRET
  const baseUrl = process.env.FILES_BASE_URL?.trim() || 'https://files.keytao.rea.ink'
  if (!secret?.trim()) throw new Error('Object storage is not configured')
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    throw new Error('Object storage is not configured')
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Object storage is not configured')
  }
  return { origin: url.origin, secret }
}

export function isObjectStorageConfigured(): boolean {
  try {
    storageConfig()
    return true
  } catch {
    return false
  }
}

function signedUrl(path: string, payload: FileToken) {
  const { origin, secret } = storageConfig()
  const encoded = encodeTokenPayload(payload)
  const signature = createHmac('sha256', secret).update(encoded).digest('hex')
  return `${origin}/${path}/${encoded}.${signature}`
}

function expiration() {
  return Math.floor(Date.now() / 1000) + PRESIGN_EXPIRY_SECONDS
}

export function presignPut(key: string, { contentLength, sha256 }: { contentLength: number; sha256: string }) {
  if (!Number.isSafeInteger(contentLength) || contentLength < 1 || !/^[a-f0-9]{64}$/i.test(sha256)) {
    throw new Error('Invalid object upload metadata')
  }
  const url = signedUrl('u', { op: 'put', key, size: contentLength, sha256: sha256.toLowerCase(), exp: expiration() })
  return { url, headers: { 'Content-Length': String(contentLength), 'Content-Type': 'application/zip' } }
}

export function presignGet(key: string, filename: string): string {
  return signedUrl('d', { op: 'get', key, filename, exp: expiration() })
}

async function objectRequest(key: string, op: 'head' | 'delete') {
  const url = signedUrl(`internal/${op}`, { op, key, exp: expiration() })
  const response = await fetch(url, { method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(5_000) })
  if (!response.ok && response.status !== 404) {
    throw new Error(`Object storage ${op.toUpperCase()} failed (${response.status})`)
  }
  return response
}

export async function headObject(key: string): Promise<{ size: number; sha256: string } | null> {
  const response = await objectRequest(key, 'head')
  if (response.status === 404) return null
  const metadata: unknown = await response.json()
  if (!metadata || typeof metadata !== 'object' || !('size' in metadata) || !('sha256' in metadata)
    || typeof metadata.size !== 'number' || !Number.isSafeInteger(metadata.size) || metadata.size < 0
    || typeof metadata.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(metadata.sha256)) {
    throw new Error('Object storage returned invalid metadata')
  }
  return { size: metadata.size, sha256: metadata.sha256 }
}

export async function deleteObject(key: string): Promise<void> {
  await objectRequest(key, 'delete')
}
