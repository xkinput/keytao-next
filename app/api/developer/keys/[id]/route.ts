import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { decryptApiKey } from '@/lib/apiKeySecrets'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const { id } = await params
  const keyId = Number(id)
  if (!/^[1-9]\d*$/.test(id) || keyId > 2_147_483_647) {
    return NextResponse.json({ error: '无效 ID' }, { status: 400 })
  }

  const record = await prisma.apiKey.findUnique({
    where: { id: keyId, userId: session.id, enabled: true },
    select: { keyHash: true, encryptedKey: true },
  })
  if (!record) return NextResponse.json({ error: '不存在或无权操作' }, { status: 404 })
  if (!record.encryptedKey) {
    return NextResponse.json({ error: '这个旧 Key 成功调用一次 API 后即可查看。若已遗失，可以新建 Key。' }, { status: 409 })
  }

  const plaintextKey = decryptApiKey(record.encryptedKey, session.id, record.keyHash)
  if (!plaintextKey) return NextResponse.json({ error: '暂时无法读取 API Key' }, { status: 503 })

  return NextResponse.json({ plaintextKey }, { headers: { 'Cache-Control': 'private, no-store' } })
}

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
