import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const MAX_NICKNAME_LENGTH = 50
const MAX_EMAIL_LENGTH = 254

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const { nickname, email } = await request.json()
    const normalizedNickname = typeof nickname === 'string' ? nickname.trim() : ''
    const normalizedEmail = typeof email === 'string' ? email.trim() : ''

    if (nickname !== undefined && typeof nickname !== 'string') {
      return NextResponse.json({ error: '昵称格式不正确' }, { status: 400 })
    }

    if (email !== undefined && typeof email !== 'string') {
      return NextResponse.json({ error: '邮箱格式不正确' }, { status: 400 })
    }

    if (normalizedNickname.length > MAX_NICKNAME_LENGTH || normalizedEmail.length > MAX_EMAIL_LENGTH) {
      return NextResponse.json({ error: '昵称或邮箱过长' }, { status: 400 })
    }

    // Validate email format if provided
    if (normalizedEmail) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(normalizedEmail)) {
        return NextResponse.json({ error: '邮箱格式不正确' }, { status: 400 })
      }

      // Check if email already exists for another user
      const existingUser = await prisma.user.findFirst({
        where: {
          email: normalizedEmail,
          NOT: { id: session.id }
        }
      })

      if (existingUser) {
        return NextResponse.json({ error: '邮箱已被使用' }, { status: 400 })
      }
    }

    // Update user profile
    const updatedUser = await prisma.user.update({
      where: { id: session.id },
      data: {
        nickname: normalizedNickname || null,
        email: normalizedEmail || null
      },
      select: {
        id: true,
        name: true,
        nickname: true,
        email: true
      }
    })

    return NextResponse.json({
      message: '资料更新成功',
      user: updatedUser
    })
  } catch (error) {
    console.error('Update profile error:', error)
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 })
  }
}
