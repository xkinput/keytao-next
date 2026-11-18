import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function POST() {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    await prisma.user.update({
      where: { id: session.id },
      data: { tokenVersion: { increment: 1 } },
      select: { id: true },
    })

    return NextResponse.json({ message: '已退出所有设备' })
  } catch (error) {
    console.error('Logout all error:', error)
    return NextResponse.json({ error: '退出失败，请稍后重试' }, { status: 500 })
  }
}
