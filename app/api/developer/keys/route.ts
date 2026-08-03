import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { apiKeyPrefix, generateApiKey, hashApiKey } from '@/lib/apiKeyAuth'

const MAX_KEYS_PER_USER = 5
const MAX_KEY_NAME_LENGTH = 60

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: '未登录' }, { status: 401 })

  // Only the prefix is stored, so the list can never leak a usable key.
  const keys = await prisma.apiKey.findMany({
    where: { userId: session.id },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
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
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: '请填写 Key 名称' }, { status: 400 })
  if (name.length > MAX_KEY_NAME_LENGTH) return NextResponse.json({ error: 'Key 名称过长' }, { status: 400 })

  const count = await prisma.apiKey.count({ where: { userId: session.id } })
  if (count >= MAX_KEYS_PER_USER) {
    return NextResponse.json(
      { error: `每个用户最多创建 ${MAX_KEYS_PER_USER} 个 API Key` },
      { status: 400 }
    )
  }

  const plaintext = generateApiKey()

  const key = await prisma.apiKey.create({
    data: {
      keyHash: hashApiKey(plaintext),
      keyPrefix: apiKeyPrefix(plaintext),
      name,
      userId: session.id,
    },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      enabled: true,
      createdAt: true,
      lastUsedAt: true,
      requestCount: true,
    },
  })

  // The plaintext is returned here and nowhere else — it is not recoverable.
  return NextResponse.json({ key: { ...key, plaintextKey: plaintext } }, { status: 201 })
}
