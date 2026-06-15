import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const { id } = await params
  const keyId = parseInt(id, 10)
  if (!Number.isInteger(keyId) || keyId <= 0) return NextResponse.json({ error: '无效 ID' }, { status: 400 })

  const record = await prisma.apiKey.findUnique({
    where: { id: keyId },
    select: { userId: true },
  })

  if (!record || record.userId !== session.id) {
    return NextResponse.json({ error: '不存在或无权操作' }, { status: 404 })
  }

  await prisma.apiKey.delete({ where: { id: keyId } })
  return NextResponse.json({ message: '删除成功' })
}
