import { createHash, randomBytes } from 'crypto'
import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRateLimit } from '@/lib/rateLimit'

export interface ApiKeyContext {
  userId: number
  apiKeyId: number
}

/** Number of leading characters kept in plaintext purely for display. */
export const API_KEY_PREFIX_LENGTH = 8

/**
 * Generate a fresh API key. The plaintext is returned to the caller exactly
 * once; only `hashApiKey(plaintext)` and the leading `API_KEY_PREFIX_LENGTH`
 * characters are persisted.
 */
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

export async function verifyApiKey(): Promise<
  { success: true; ctx: ApiKeyContext } | { success: false; response: NextResponse }
> {
  const headersList = await headers()
  const apiKey = headersList.get('x-api-key')

  if (!apiKey) {
    return {
      success: false,
      response: NextResponse.json(
        { error: '缺少 X-API-Key 请求头' },
        { status: 401 }
      ),
    }
  }

  const record = await prisma.apiKey.findUnique({
    where: { keyHash: hashApiKey(apiKey) },
    select: {
      id: true,
      userId: true,
      enabled: true,
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

  // Update usage stats asynchronously, don't await
  prisma.apiKey.update({
    where: { id: record.id },
    data: { lastUsedAt: new Date(), requestCount: { increment: 1 } },
  }).catch(() => {})

  return { success: true, ctx: { userId: record.userId, apiKeyId: record.id } }
}
