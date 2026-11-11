import type { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { checkRateLimit } from '@/lib/rateLimit'
import { isObjectStorageConfigured, PRESIGN_EXPIRY_SECONDS } from '@/lib/objectStorage'
import { InvalidJsonBodyError, RequestBodyTooLargeError } from '@/lib/limitedJsonBody'

export const MAX_READY_PACKAGES = 20
export const MAX_PENDING_PACKAGES = 5
export const PACKAGE_UPLOAD_RETENTION_MS = (PRESIGN_EXPIRY_SECONDS + 60) * 1000

export const schemePackageSelect = {
  id: true,
  schemeKey: true,
  name: true,
  version: true,
  size: true,
  sha256: true,
  createAt: true,
} as const

export async function schemeSyncSession(packages = false) {
  const session = await getSession()
  if (!session) {
    return { response: NextResponse.json({ error: '未登录' }, { status: 401 }) }
  }
  const { allowed, retryAfterMs } = checkRateLimit(`scheme-sync:${session.id}`)
  if (!allowed) {
    return {
      response: NextResponse.json({ error: '请求过于频繁', retryAfterMs }, {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) },
      }),
    }
  }
  if (packages && !isObjectStorageConfigured()) {
    return { response: NextResponse.json({ error: '对象存储未配置' }, { status: 503 }) }
  }
  return { session }
}

export function schemeSyncError(error: unknown, status = 500) {
  if (error instanceof InvalidJsonBodyError || error instanceof RequestBodyTooLargeError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }
  return NextResponse.json({ error: '方案同步失败，请稍后重试' }, { status })
}

export function isJsonObject(value: unknown): value is Prisma.InputJsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function parseSchemePackageId(id: string) {
  const parsed = Number(id)
  return /^\d+$/.test(id) && Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 2147483647
    ? parsed : null
}

export async function lockSchemePackages(tx: Prisma.TransactionClient, userId: number) {
  // Share a user row lock across creation, completion and deletion to enforce quotas.
  await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${userId} FOR UPDATE`
}
