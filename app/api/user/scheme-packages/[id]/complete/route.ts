import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { deleteObject, headObject } from '@/lib/objectStorage'
import {
  lockSchemePackages,
  MAX_READY_PACKAGES,
  parseSchemePackageId,
  schemeSyncError,
  schemeSyncSession,
} from '@/lib/schemeSync'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { session, response } = await schemeSyncSession(true)
    if (response) return response
    const id = parseSchemePackageId((await params).id)
    if (id === null) return NextResponse.json({ error: '方案包不存在' }, { status: 404 })

    return await prisma.$transaction(async tx => {
      await lockSchemePackages(tx, session.id)
      const record = await tx.schemePackage.findUnique({ where: { id } })
      if (!record || record.userId !== session.id) {
        return NextResponse.json({ error: '方案包不存在' }, { status: 404 })
      }
      if (record.status === 'READY') {
        return NextResponse.json({ id, status: 'READY' })
      }
      const object = await headObject(record.storageKey)
      if (!object || object.size !== record.size) {
        if (object) await deleteObject(record.storageKey)
        return NextResponse.json({ error: '方案包大小不匹配，请重新上传' }, { status: 400 })
      }
      const ready = await tx.schemePackage.count({ where: { userId: session.id, status: 'READY' } })
      if (ready >= MAX_READY_PACKAGES) {
        return NextResponse.json({ error: '每个用户最多保存 20 个方案包' }, { status: 400 })
      }
      await tx.schemePackage.update({ where: { id }, data: { status: 'READY' } })
      return NextResponse.json({ id, status: 'READY' })
    }, { timeout: 25_000 })
  } catch (error) {
    return schemeSyncError(error, 502)
  }
}
