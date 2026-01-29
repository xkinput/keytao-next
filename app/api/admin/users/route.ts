import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkAdminPermission } from '@/lib/adminAuth'

export async function GET() {
  // 验证管理员权限
  const authCheck = await checkAdminPermission()
  if (!authCheck.authorized) {
    return authCheck.response
  }

  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        nickname: true,
        email: true,
        status: true,
        createAt: true,
      },
      orderBy: { createAt: 'desc' },
    })

    return NextResponse.json({ users })
  } catch (error) {
    console.error('Get users error:', error)
    return NextResponse.json(
      { error: '获取用户列表失败' },
      { status: 500 }
    )
  }
}
