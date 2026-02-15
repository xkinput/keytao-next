import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const { nickname, email } = await request.json()

    // Validate email format if provided
    if (email && email.trim() !== '') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(email)) {
        return NextResponse.json({ error: '邮箱格式不正确' }, { status: 400 })
      }

      // Check if email already exists for another user
      const existingUser = await prisma.user.findFirst({
        where: {
          email,
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
        nickname: nickname?.trim() || null,
        email: email?.trim() || null
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
