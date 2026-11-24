import { NextRequest, NextResponse } from 'next/server'
import { getSession, signToken, validatePassword } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcrypt'

const MAX_PASSWORD_LENGTH = 128

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const { currentPassword, newPassword } = await request.json()

    if (typeof currentPassword !== 'string' || !currentPassword) {
      return NextResponse.json({ error: '请输入当前密码' }, { status: 400 })
    }

    if (currentPassword.length > MAX_PASSWORD_LENGTH || typeof newPassword !== 'string' || newPassword.length > MAX_PASSWORD_LENGTH) {
      return NextResponse.json({ error: '密码格式不正确' }, { status: 400 })
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
    const [updatedUser] = await prisma.user.updateManyAndReturn({
      where: { id: session.id, tokenVersion: session.tv ?? 0, status: 'ENABLE' },
      data: { password: hashedPassword, tokenVersion: { increment: 1 } },
      select: { id: true, name: true, tokenVersion: true },
    })

    if (!updatedUser) {
      return NextResponse.json({ error: '登录已失效，请重新登录' }, { status: 401 })
    }

    const token = await signToken({
      id: updatedUser.id,
      name: updatedUser.name ?? session.name,
      tv: updatedUser.tokenVersion,
    }, session.jti)

    return NextResponse.json({ message: '密码修改成功', token })
  } catch (error) {
    console.error('Change password error:', error)
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 })
  }
}
