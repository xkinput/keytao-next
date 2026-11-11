import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { readLimitedJson } from '@/lib/limitedJsonBody'
import { isJsonObject, schemeSyncError, schemeSyncSession } from '@/lib/schemeSync'

export async function GET() {
  try {
    const { session, response } = await schemeSyncSession()
    if (response) return response

    const profile = await prisma.schemeProfile.findUnique({
      where: { userId: session.id },
      select: { data: true, updateAt: true },
    })
    return NextResponse.json({ profile: profile?.data ?? null, updateAt: profile?.updateAt ?? null })
  } catch (error) {
    return schemeSyncError(error)
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { session, response } = await schemeSyncSession()
    if (response) return response

    const body = await readLimitedJson(request, 256 * 1024)
    if (!isJsonObject(body) || !isJsonObject(body.data)) {
      return NextResponse.json({ error: '方案配置必须为对象' }, { status: 400 })
    }
    const profile = await prisma.schemeProfile.upsert({
      where: { userId: session.id },
      create: { userId: session.id, data: body.data },
      update: { data: body.data },
      select: { data: true, updateAt: true },
    })
    return NextResponse.json({ profile: profile.data, updateAt: profile.updateAt })
  } catch (error) {
    return schemeSyncError(error)
  }
}
