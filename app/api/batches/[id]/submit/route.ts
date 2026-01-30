import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { conflictDetector } from '@/lib/services/conflictDetector'

// POST /api/batches/:id/submit - Submit batch for review
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
      where: { id },
      include: {
        pullRequests: true
      }
    })

    if (!batch) {
      return NextResponse.json({ error: '批次不存在' }, { status: 404 })
    }

    if (batch.creatorId !== session.id) {
      return NextResponse.json({ error: '无权限' }, { status: 403 })
    }

    if (batch.status !== 'Draft') {
      return NextResponse.json(
        { error: '只能提交草稿状态的批次' },
        { status: 400 }
      )
    }

    if (batch.pullRequests.length === 0) {
      return NextResponse.json(
        { error: '批次中没有修改提议' },
        { status: 400 }
      )
    }

    // Validate batch for conflicts
    const changes = batch.pullRequests.map((pr) => ({
      action: pr.action,
      word: pr.word || '',
      code: pr.code || '',
      phraseId: pr.phraseId || undefined,
      weight: pr.weight || undefined
    }))

    const validation = await conflictDetector.validateBatch(changes)

    if (!validation.valid) {
      return NextResponse.json(
        {
          error: '批次中存在未解决的冲突',
          conflicts: validation.unresolvedConflicts
        },
        { status: 400 }
      )
    }

    // Update batch status
    const updated = await prisma.batch.update({
      where: { id },
      data: { status: 'Submitted' }
    })

    return NextResponse.json({ batch: updated })
  } catch (error) {
    console.error('Submit batch error:', error)
    return NextResponse.json({ error: '提交批次失败' }, { status: 500 })
  }
}
