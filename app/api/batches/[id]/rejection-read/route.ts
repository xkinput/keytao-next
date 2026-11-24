import { NextResponse, type NextRequest } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: '未登录' }, { status: 401 })

    const { id } = await params
    const body = await request.json().catch(() => null)
    const version = body?.expectedContentVersion
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 0 || version > 2147483647) {
      return NextResponse.json({ error: '批次版本无效' }, { status: 400 })
    }

    // A read receipt must not change the batch's content version or modification time.
    const updated = await prisma.$executeRaw`
      UPDATE "batches" SET "rejectionRead" = true
      WHERE "id" = ${id} AND "creatorId" = ${session.id} AND "status" = 'Rejected'
        AND "contentVersion" = ${version}
    `
    if (!updated) {
      return NextResponse.json({ error: '草稿无法标记为已读，请刷新后重试' }, { status: 409 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Mark batch rejection read error:', error)
    return NextResponse.json({ error: '标记已读失败' }, { status: 500 })
  }
}
