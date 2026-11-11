import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { readLimitedJson } from '@/lib/limitedJsonBody'
import { deleteObject, presignPut } from '@/lib/objectStorage'
import {
  isJsonObject,
  lockSchemePackages,
  MAX_PENDING_PACKAGES,
  MAX_READY_PACKAGES,
  PACKAGE_UPLOAD_RETENTION_MS,
  schemePackageSelect,
  schemeSyncError,
  schemeSyncSession,
} from '@/lib/schemeSync'

export async function GET() {
  try {
    const { session, response } = await schemeSyncSession(true)
    if (response) return response

    const packages = await prisma.schemePackage.findMany({
      where: { userId: session.id, status: 'READY' },
      select: schemePackageSelect,
      orderBy: { createAt: 'desc' },
    })
    return NextResponse.json({ packages })
  } catch (error) {
    return schemeSyncError(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const { session, response } = await schemeSyncSession(true)
    if (response) return response

    const body = await readLimitedJson(request, 8 * 1024)
    if (!isJsonObject(body)) {
      return NextResponse.json({ error: '请求格式错误' }, { status: 400 })
    }
    const { schemeKey, name, version, size, sha256 } = body
    if (typeof schemeKey !== 'string' || !schemeKey.trim() || schemeKey.length > 40 ||
        typeof name !== 'string' || !name.trim() || name.length > 100 ||
        (version !== undefined && typeof version !== 'string') ||
        typeof size !== 'number' || !Number.isInteger(size) || size < 1 || size > 30 * 1024 * 1024 ||
        typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(sha256)) {
      return NextResponse.json({ error: '方案包参数无效' }, { status: 400 })
    }

    return await prisma.$transaction(async tx => {
      await lockSchemePackages(tx, session.id)
      const expiredWhere = {
        userId: session.id,
        status: 'PENDING' as const,
        createAt: { lt: new Date(Date.now() - PACKAGE_UPLOAD_RETENTION_MS) },
      }
      const expired = await tx.schemePackage.findMany({ where: expiredWhere, select: { storageKey: true } })
      const cleanup = await Promise.allSettled(expired.map(record => deleteObject(record.storageKey)))
      const failed = cleanup.find(result => result.status === 'rejected')
      if (failed?.status === 'rejected') throw failed.reason
      await tx.schemePackage.deleteMany({
        where: expiredWhere,
      })
      const ready = await tx.schemePackage.count({ where: { userId: session.id, status: 'READY' } })
      const pending = await tx.schemePackage.count({ where: { userId: session.id, status: 'PENDING' } })
      if (ready >= MAX_READY_PACKAGES || pending >= MAX_PENDING_PACKAGES) {
        return NextResponse.json({ error: '每个用户最多保存 20 个方案包，最多同时上传 5 个' }, { status: 400 })
      }

      const storageKey = `scheme-packages/${session.id}/${randomUUID()}.zip`
      const upload = await presignPut(storageKey, { contentLength: size, sha256 })
      const record = await tx.schemePackage.create({
        data: {
          userId: session.id,
          schemeKey: schemeKey.trim(),
          name: name.trim(),
          version,
          size,
          sha256: sha256.toLowerCase(),
          storageKey,
          status: 'PENDING',
        },
        select: { id: true },
      })
      return NextResponse.json({ id: record.id, uploadUrl: upload.url, headers: upload.headers }, { status: 201 })
    }, { timeout: 15_000 })
  } catch (error) {
    return schemeSyncError(error)
  }
}
