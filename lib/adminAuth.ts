import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * 检查用户是否为管理员
 */
export async function checkAdminPermission() {
  // 获取当前会话
  const session = await getSession()

  if (!session) {
    return {
      authorized: false,
      response: NextResponse.json({ error: '未登录' }, { status: 401 })
    }
  }

  // 查询用户及其角色
  const user = await prisma.user.findUnique({
    where: { id: session.id },
    include: {
      roles: true
    }
  })

  if (!user) {
    return {
      authorized: false,
      response: NextResponse.json({ error: '用户不存在' }, { status: 404 })
    }
  }

  const isAdmin = user.roles.some((role: { value: string }) => ["R:ROOT", "R:MANAGER"].includes(role.value))

  if (!isAdmin) {
    return {
      authorized: false,
      response: NextResponse.json({ error: '权限不足' }, { status: 403 })
    }
  }

  return {
    authorized: true,
    user,
    session
  }
}

/**
 * Check if user is ROOT admin (initial administrator)
 */
export async function checkRootAdminPermission() {
  const session = await getSession()

  if (!session) {
    return {
      authorized: false,
      response: NextResponse.json({ error: '未登录' }, { status: 401 })
    }
  }

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    include: {
      roles: true
    }
  })

  if (!user) {
    return {
      authorized: false,
      response: NextResponse.json({ error: '用户不存在' }, { status: 404 })
    }
  }

  const isRootAdmin = user.roles.some((role: { value: string }) => role.value === "R:ROOT")

  if (!isRootAdmin) {
    return {
      authorized: false,
      response: NextResponse.json({ error: '权限不足，仅初始管理员可访问' }, { status: 403 })
    }
  }

  return {
    authorized: true,
    user,
    session
  }
}
