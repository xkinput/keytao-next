import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRootAdminPermission } from '@/lib/adminAuth'

// PUT /api/admin/users/:id/role — set or remove MANAGER role (root only)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authCheck = await checkRootAdminPermission()
  if (!authCheck.authorized) return authCheck.response

  const { id } = await params
  const userId = parseInt(id, 10)
  if (isNaN(userId)) {
    return NextResponse.json({ error: '无效用户 ID' }, { status: 400 })
  }

  const { role } = await request.json() as { role: 'R:MANAGER' | null }

  const target = await prisma.user.findUnique({
    where: { id: userId },
    include: { roles: { select: { value: true } } },
  })

  if (!target) return NextResponse.json({ error: '用户不存在' }, { status: 404 })

  // Prevent modifying ROOT admin roles
  if (target.roles.some(r => r.value === 'R:ROOT')) {
    return NextResponse.json({ error: '不能修改初始管理员的角色' }, { status: 403 })
  }

  const managerRole = await prisma.role.findUnique({ where: { value: 'R:MANAGER' } })
  if (!managerRole) {
    return NextResponse.json({ error: '角色 R:MANAGER 不存在，请联系管理员初始化数据库' }, { status: 500 })
  }

  const hasManager = target.roles.some(r => r.value === 'R:MANAGER')

  if (role === 'R:MANAGER' && !hasManager) {
    await prisma.user.update({
      where: { id: userId },
      data: { roles: { connect: { id: managerRole.id } } },
    })
  } else if (role === null && hasManager) {
    await prisma.user.update({
      where: { id: userId },
      data: { roles: { disconnect: { id: managerRole.id } } },
    })
  }

  return NextResponse.json({ success: true })
}
