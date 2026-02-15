import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { compareSync } from 'bcrypt'
import { signToken } from '@/lib/auth'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, password } = body

    if (!name || !password) {
      return NextResponse.json(
        { error: '用户名和密码不能为空' },
        { status: 400 }
      )
    }

    const user = await prisma.user.findUnique({
      where: { name },
      include: { roles: true }
    })

    if (!user || !user.password) {
      return NextResponse.json(
        { error: '用户名或密码错误' },
        { status: 401 }
      )
    }

    // Check status
    if (user.status !== 'ENABLE') {
      return NextResponse.json(
        { error: '账号已被禁用' },
        { status: 403 }
      )
    }

    // Verify password
    const valid = compareSync(password, user.password)
    if (!valid) {
      return NextResponse.json(
        { error: '用户名或密码错误' },
        { status: 401 }
      )
    }

    const token = await signToken({
      id: user.id,
      name: user.name!
    })

    return NextResponse.json({
      user: {
        id: user.id,
        name: user.name,
        nickname: user.nickname,
        email: user.email,
        roles: user.roles
      },
      token
    })
  } catch (error) {
    console.error('Login error:', error)
    return NextResponse.json(
      { error: '登录失败' },
      { status: 500 }
    )
  }
}
