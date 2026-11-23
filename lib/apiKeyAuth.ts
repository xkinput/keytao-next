import { createHash, randomBytes } from 'crypto'
import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { encryptApiKey } from '@/lib/apiKeySecrets'
import { prisma } from '@/lib/prisma'
import { checkRateLimit } from '@/lib/rateLimit'

export interface ApiKeyContext {
  userId: number
  apiKeyId: number
}

/** Number of leading characters kept in plaintext purely for display. */
export const API_KEY_PREFIX_LENGTH = 8

export function generateApiKey(): string {
  return 'kt_' + randomBytes(24).toString('base64url')
}

/**
 * Lowercase hex SHA-256 of the key. Must stay byte-for-byte compatible with
 * the backfill in `prisma/migrations/*_bot_role_reviewer_and_api_key_hash`,
 * which uses `encode(sha256(convert_to(key, 'UTF8')), 'hex')`.
 */
export function hashApiKey(plaintext: string): string {
  return createHash('sha256').update(plaintext, 'utf8').digest('hex')
}

export function apiKeyPrefix(plaintext: string): string {
  return plaintext.slice(0, API_KEY_PREFIX_LENGTH)
}

async function readApiKeyHeader(request?: Request): Promise<string | null> {
  if (request?.headers.has('x-api-key')) {
    return request.headers.get('x-api-key')
  }
  try {
    return (await headers()).get('x-api-key')
  } catch {
    return null
  }
}

export async function verifyApiKey(request?: Request): Promise<
  { success: true; ctx: ApiKeyContext } | { success: false; response: NextResponse }
> {
  const apiKey = await readApiKeyHeader(request)

  if (!apiKey) {
    return {
      success: false,
      response: NextResponse.json(
        { error: '缺少 X-API-Key 请求头' },
        { status: 401 }
      ),
    }
  }

  const keyHash = hashApiKey(apiKey)
  const record = await prisma.apiKey.findUnique({
    where: { keyHash },
    select: {
      id: true,
      userId: true,
      enabled: true,
      encryptedKey: true,
      user: { select: { status: true } },
    },
  })

  if (!record) {
    return {
      success: false,
      response: NextResponse.json({ error: 'API Key 无效' }, { status: 401 }),
    }
  }

  if (!record.enabled) {
    return {
      success: false,
      response: NextResponse.json({ error: 'API Key 已被禁用' }, { status: 403 }),
    }
  }

  // A disabled or banned account must not keep write access through a key it
  // created while still enabled.
  if (record.user?.status !== 'ENABLE') {
    return {
      success: false,
      response: NextResponse.json({ error: '账号已被禁用' }, { status: 403 }),
    }
  }

  const { allowed, retryAfterMs } = checkRateLimit(apiKey)
  if (!allowed) {
    return {
      success: false,
      response: NextResponse.json(
        { error: '请求过于频繁，每秒最多 1 次', retryAfterMs },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) },
        }
      ),
    }
  }

  // The original value of a hash-only key is available after successful authentication.
  const encryptedKey = record.encryptedKey === null ? encryptApiKey(apiKey, record.userId, keyHash) : null
  const usageUpdate = prisma.apiKey.update({
    where: { id: record.id },
    data: {
      lastUsedAt: new Date(),
      requestCount: { increment: 1 },
      ...(encryptedKey ? { encryptedKey } : {}),
    },
  }).catch(() => {})
  if (encryptedKey) await usageUpdate

  return { success: true, ctx: { userId: record.userId, apiKeyId: record.id } }
}
