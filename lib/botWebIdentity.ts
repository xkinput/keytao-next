import { createHash, createHmac, randomBytes } from 'crypto'

export class BotIdentityConfigError extends Error {
  constructor() {
    super('服务端未配置 BOT_IDENTITY_SECRET，无法安全地转发聊天请求')
    this.name = 'BotIdentityConfigError'
  }
}

export function signWebUserIdentity(
  secret: string,
  params: {
    userId: number
    method: string
    path: string
    timestamp: number | string
    nonce: string
    bodySha256: string
  }
): string {
  const message = [
    params.method.toUpperCase(),
    params.path,
    params.userId,
    params.timestamp,
    params.nonce,
    params.bodySha256,
  ].join('\n')
  return createHmac('sha256', secret).update(message).digest('hex')
}

export function buildWebUserIdentityHeaders(
  request: { userId: number; method: string; path: string; rawBody: string },
  now: Date = new Date()
): Record<string, string> {
  const secret = process.env.BOT_IDENTITY_SECRET
  if (!secret) throw new BotIdentityConfigError()
  const timestamp = Math.floor(now.getTime() / 1000).toString()
  const nonce = randomBytes(16).toString('hex')
  const bodySha256 = createHash('sha256').update(request.rawBody).digest('hex')
  return {
    'X-Web-User-Id': String(request.userId),
    'X-Web-User-Ts': timestamp,
    'X-Web-User-Nonce': nonce,
    'X-Web-User-Sig': signWebUserIdentity(secret, { ...request, timestamp, nonce, bodySha256 }),
  }
}
