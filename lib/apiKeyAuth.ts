import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRateLimit } from '@/lib/rateLimit'

export interface ApiKeyContext {
  userId: number
  apiKeyId: number
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
    where: { key: apiKey },
    select: { id: true, userId: true, enabled: true },
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
