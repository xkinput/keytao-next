import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { deleteObject, presignGet } from '@/lib/objectStorage'
import { lockSchemePackages, PACKAGE_UPLOAD_RETENTION_MS, parseSchemePackageId, schemeSyncError, schemeSyncSession } from '@/lib/schemeSync'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { session, response } = await schemeSyncSession(true)
    if (response) return response
    const id = parseSchemePackageId((await params).id)
    if (id === null) return NextResponse.json({ error: '方案包不存在' }, { status: 404 })

    const record = await prisma.schemePackage.findUnique({ where: { id } })
    if (!record || record.userId !== session.id || record.status !== 'READY') {
      return NextResponse.json({ error: '方案包不存在' }, { status: 404 })
    }
    const filename = record.name.endsWith('.zip') ? record.name : `${record.name}.zip`
    const url = await presignGet(record.storageKey, filename)
    return NextResponse.redirect(url, { status: 302, headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    return schemeSyncError(error, 502)
  }
}

export async function DELETE(
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
      // READY packages also retain a reusable PUT URL until the upload window expires.
      if (record.createAt.getTime() >= Date.now() - PACKAGE_UPLOAD_RETENTION_MS) {
        return NextResponse.json({ error: '上传保护期尚未结束，请稍后再删除方案包' }, { status: 409 })
      }
      await deleteObject(record.storageKey)
      await tx.schemePackage.delete({ where: { id } })
      return NextResponse.json({ success: true })
    }, { timeout: 15_000 })
  } catch (error) {
    return schemeSyncError(error, 502)
  }
}
