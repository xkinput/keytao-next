import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// POST /api/batches/:id/withdraw - Withdraw submitted batch
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const batch = await prisma.batch.findUnique({
      where: { id }
    })

    if (!batch) {
      return NextResponse.json({ error: '批次不存在' }, { status: 404 })
    }

    if (batch.creatorId !== session.id) {
      return NextResponse.json({ error: '无权限' }, { status: 403 })
    }

    if (batch.status !== 'Submitted') {
      return NextResponse.json(
        { error: '只能撤销已提交状态的批次' },
        { status: 400 }
      )
    }

    const updated = await prisma.$transaction(async (tx) => {
      const transitioned = await tx.batch.updateMany({
        where: {
          id,
          creatorId: session.id,
          status: 'Submitted',
          contentVersion: batch.contentVersion,
        },
        data: { status: 'Draft', contentVersion: { increment: 1 } },
      })
      if (transitioned.count !== 1) return null
      return tx.batch.findUniqueOrThrow({ where: { id } })
    })

    if (!updated) {
      return NextResponse.json(
        { error: '批次内容或状态已被其他操作修改，请刷新后重试' },
        { status: 409 }
      )
    }

    return NextResponse.json({ batch: updated })
  } catch (error) {
    console.error('Withdraw batch error:', error)
    return NextResponse.json({ error: '撤销批次失败' }, { status: 500 })
  }
}
