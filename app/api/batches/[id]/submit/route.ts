import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkBatchConflictsWithWeight } from '@/lib/services/batchConflictService'
import { PhraseType } from '@/lib/constants/phraseTypes'

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

    if (batch.status !== 'Draft' && batch.status !== 'Rejected') {
      return NextResponse.json(
        { error: '只能提交草稿或已拒绝状态的批次' },
        { status: 400 }
      )
    }

    if (batch.pullRequests.length === 0) {
      return NextResponse.json(
        { error: '批次中没有修改提议' },
        { status: 400 }
      )
    }

    // Validate batch for conflicts using the same logic as check-conflicts-batch
    const items = batch.pullRequests.map((pr) => ({
      id: pr.id.toString(),
      action: pr.action as 'Create' | 'Change' | 'Delete',
      word: pr.word || '',
      oldWord: pr.oldWord || undefined,
      code: pr.code || '',
      type: (pr.type || 'Phrase') as PhraseType,
      weight: pr.weight || undefined
    }))

    const results = await checkBatchConflictsWithWeight(items)

    // Check for unresolved conflicts
    const unresolvedConflicts = results
      .filter(result => {
        const isResolved = result.conflict.suggestions?.some(sug => sug.action === 'Resolved')
        return result.conflict.hasConflict && !isResolved
      })
      .map(result => result.conflict)

    if (unresolvedConflicts.length > 0) {
      return NextResponse.json(
        {
          error: '批次中存在未解决的冲突',
          conflicts: unresolvedConflicts
        },
        { status: 400 }
      )
    }

    // Update batch status
    const updated = await prisma.batch.update({
      where: { id },
      data: {
        status: 'Submitted',
        reviewNote: null // Clear previous rejection note
      }
    })

    return NextResponse.json({ batch: updated })
  } catch (error) {
    console.error('Submit batch error:', error)
    return NextResponse.json({ error: '提交批次失败' }, { status: 500 })
  }
}
