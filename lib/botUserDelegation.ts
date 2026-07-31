import { createHash, createHmac, timingSafeEqual } from 'crypto'

const MAX_CLOCK_SKEW_SECONDS = 300
const MAX_NONCES = 10_000
const usedNonces = new Map<string, number>()

function safeHexEqual(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'))
}

function consumeNonce(nonce: string, nowSeconds: number): boolean {
  const minimum = nowSeconds - MAX_CLOCK_SKEW_SECONDS
  for (const [key, seenAt] of usedNonces) {
    if (seenAt < minimum) usedNonces.delete(key)
  }
  if (usedNonces.has(nonce) || usedNonces.size >= MAX_NONCES) return false
  usedNonces.set(nonce, nowSeconds)
  return true
}

export function verifyWebBotDelegation(
  request: Request,
  platform: string,
  platformId: string,
  rawBody: string,
  now: Date = new Date()
): boolean {
  const secret = process.env.BOT_IDENTITY_SECRET
  if (!secret) return false

  const timestamp = request.headers.get('X-Bot-User-Ts') ?? ''
  const nonce = request.headers.get('X-Bot-User-Nonce') ?? ''
  const signature = request.headers.get('X-Bot-User-Sig') ?? ''
  if (!/^\d{10}$/.test(timestamp) || !/^[a-f0-9]{32}$/.test(nonce)) return false

  const timestampSeconds = Number(timestamp)
  const nowSeconds = Math.floor(now.getTime() / 1000)
  if (!Number.isSafeInteger(timestampSeconds) || Math.abs(nowSeconds - timestampSeconds) > MAX_CLOCK_SKEW_SECONDS) {
    return false
  }

  const path = new URL(request.url).pathname
  const bodySha256 = createHash('sha256').update(rawBody).digest('hex')
  const canonical = [
    request.method.toUpperCase(),
    path,
    platform,
    platformId,
    timestamp,
    nonce,
    bodySha256,
  ].join('\n')
  const expected = createHmac('sha256', secret).update(canonical).digest('hex')
  if (!safeHexEqual(signature, expected)) return false
  return consumeNonce(nonce, nowSeconds)
}
