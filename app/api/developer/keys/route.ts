import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { randomBytes } from 'crypto'

const MAX_KEYS_PER_USER = 5

function generateApiKey(): string {
  return 'kt_' + randomBytes(24).toString('base64url')
}

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const keys = await prisma.apiKey.findMany({
    where: { userId: session.id },
    select: {
      id: true,
      name: true,
      key: true,
      enabled: true,
      createdAt: true,
      lastUsedAt: true,
      requestCount: true,
    },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json({ keys })
}

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const body = await request.json()
  const name = body?.name?.trim()
  if (!name) return NextResponse.json({ error: '请填写 Key 名称' }, { status: 400 })

  const count = await prisma.apiKey.count({ where: { userId: session.id } })
  if (count >= MAX_KEYS_PER_USER) {
    return NextResponse.json(
      { error: `每个用户最多创建 ${MAX_KEYS_PER_USER} 个 API Key` },
      { status: 400 }
    )
  }

  const key = await prisma.apiKey.create({
    data: { key: generateApiKey(), name, userId: session.id },
    select: {
      id: true,
      name: true,
      key: true,
      enabled: true,
      createdAt: true,
      lastUsedAt: true,
      requestCount: true,
    },
  })

  return NextResponse.json({ key }, { status: 201 })
}
