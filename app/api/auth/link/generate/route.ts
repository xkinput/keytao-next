import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * Generate link key for platform binding
 * POST /api/auth/link/generate
 */
export async function POST(_request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    // Generate 6-character key (uppercase letters + digits, excluding confusing chars)
    const key = generateLinkKey()

    // Expires in 10 minutes
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000)

    // Delete previous unused keys for this user
    await prisma.linkKey.deleteMany({
      where: {
        userId: session.id,
        isUsed: false
      }
    })

    // Create new link key
    const linkKey = await prisma.linkKey.create({
      data: {
        key,
        userId: session.id,
        expiresAt
      }
    })

    return NextResponse.json({
      key: linkKey.key,
      expiresAt: linkKey.expiresAt
    })
  } catch (error) {
    console.error('Generate link key error:', error)
    return NextResponse.json({ error: '生成绑定码失败' }, { status: 500 })
  }
}

/**
 * Generate 6-character random key
 * Uses uppercase letters and digits, excludes confusing characters (I, O, 0, 1)
 */
function generateLinkKey(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let key = ''
  for (let i = 0; i < 6; i++) {
    key += chars[Math.floor(Math.random() * chars.length)]
  }
  return key
}
