export type FileToken =
  | { op: 'put'; key: string; size: number; sha256: string; exp: number }
  | { op: 'get'; key: string; filename: string; exp: number }
  | { op: 'head' | 'delete'; key: string; exp: number }

function isFileToken(value: unknown): value is FileToken {
  if (!value || typeof value !== 'object') return false
  const payload = value as Record<string, unknown>
  if (typeof payload.key !== 'string' || !/^scheme-packages\/\d+\/[0-9a-f-]{36}\.zip$/.test(payload.key) ||
      typeof payload.exp !== 'number' || !Number.isSafeInteger(payload.exp)) return false
  if (payload.op === 'put') {
    return typeof payload.size === 'number' && Number.isSafeInteger(payload.size) && payload.size > 0 &&
      typeof payload.sha256 === 'string' && /^[a-f0-9]{64}$/.test(payload.sha256)
  }
  if (payload.op === 'get') return typeof payload.filename === 'string'
  return payload.op === 'head' || payload.op === 'delete'
}

export function encodeTokenPayload(payload: FileToken): string {
  if (!isFileToken(payload)) throw new Error('Invalid file token claims')
  return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(payload))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function signToken(payload: FileToken, secret: string): Promise<string> {
  const encoded = encodeTokenPayload(payload)
  const signature = await signatureBytes(encoded, secret)
  const hex = Array.from(signature, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${encoded}.${hex}`
}

async function signatureBytes(encoded: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encoded))
  return new Uint8Array(signature)
}

export async function verifyToken(
  token: string,
  secret: string,
  op: FileToken['op'],
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<FileToken | null> {
  if (!secret || token.length > 4096 || !/^[A-Za-z0-9_-]+\.[0-9a-f]{64}$/.test(token)) return null
  try {
    const [encoded, signature] = token.split('.')
    const expected = await signatureBytes(encoded, secret)
    let difference = 0
    for (let i = 0; i < expected.length; i++) {
      difference |= expected[i] ^ Number.parseInt(signature.slice(i * 2, i * 2 + 2), 16)
    }
    if (difference !== 0) return null
    const payload: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(
      Uint8Array.from(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0)),
    ))
    return isFileToken(payload) && payload.exp > nowSeconds && payload.op === op ? payload : null
  } catch {
    return null
  }
}
