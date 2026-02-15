import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashSync, genSaltSync } from 'bcrypt'
import { signToken, validatePassword } from '@/lib/auth'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, password, nickname, email } = body

    if (!name) {
      return NextResponse.json(
        { error: '用户名不能为空' },
        { status: 400 }
      )
    }

    const passwordValidation = validatePassword(password)
    if (!passwordValidation.valid) {
      return NextResponse.json(
        { error: passwordValidation.error },
        { status: 400 }
      )
    }

    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { name },
          ...(email ? [{ email }] : [])
        ]
      }
    })

    if (existingUser) {
      return NextResponse.json(
        { error: '用户名或邮箱已存在' },
        { status: 400 }
      )
    }

    const normalRole = await prisma.role.findUnique({
      where: { value: 'R:NORMAL' }
    })

    if (!normalRole) {
      return NextResponse.json(
        { error: '系统配置错误，请联系管理员' },
        { status: 500 }
      )
    }

    const hashedPassword = hashSync(password, genSaltSync(12))

    const user = await prisma.user.create({
      data: {
        name,
        password: hashedPassword,
        nickname: nickname || name,
        email,
        status: 'ENABLE',
        signUpType: 'USERNAME',
        roles: {
          connect: { id: normalRole.id }
        }
      },
      include: { roles: true }
    })

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
    console.error('Register error:', error)
    return NextResponse.json(
      { error: '注册失败' },
      { status: 500 }
    )
  }
}
