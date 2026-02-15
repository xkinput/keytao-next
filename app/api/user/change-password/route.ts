import { NextRequest, NextResponse } from 'next/server'
import { getSession, validatePassword } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcrypt'

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const { currentPassword, newPassword } = await request.json()

    if (!currentPassword) {
      return NextResponse.json({ error: '请输入当前密码' }, { status: 400 })
    }

    const passwordValidation = validatePassword(newPassword)
    if (!passwordValidation.valid) {
      return NextResponse.json({ error: passwordValidation.error }, { status: 400 })
    }

    // Get user with password
    const user = await prisma.user.findUnique({
      where: { id: session.id },
      select: { id: true, password: true }
    })

    if (!user || !user.password) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 })
    }

    // Verify current password
    const isPasswordValid = await bcrypt.compare(currentPassword, user.password)
    if (!isPasswordValid) {
      return NextResponse.json({ error: '当前密码不正确' }, { status: 400 })
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10)

    // Update password
    await prisma.user.update({
      where: { id: session.id },
      data: { password: hashedPassword }
    })

    return NextResponse.json({ message: '密码修改成功' })
  } catch (error) {
    console.error('Change password error:', error)
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 })
  }
}
