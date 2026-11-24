import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { DRAFT_TODO_STATUSES } from '@/lib/myDraftTodos'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: '未登录' }, { status: 401 })

    const [totals, emptyDrafts] = await Promise.all([
      prisma.batch.groupBy({
        by: ['status'],
        where: { creatorId: session.id, status: { in: DRAFT_TODO_STATUSES } },
        _count: { _all: true },
      }),
      prisma.batch.count({
        where: { creatorId: session.id, status: 'Draft', itemReviewStarted: false, pullRequests: { none: {} } },
      }),
    ])
    return NextResponse.json({
      unsubmitted: totals.find(row => row.status === 'Draft')?._count._all ?? 0,
      rejected: totals.find(row => row.status === 'Rejected')?._count._all ?? 0,
      emptyDrafts,
    }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    console.error('Get draft todos error:', error)
    return NextResponse.json({ error: '读取草稿待办失败' }, { status: 500 })
  }
}

export async function DELETE() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: '未登录' }, { status: 401 })

    const deleted = await prisma.$transaction(async tx => {
      // Lock first, then recheck emptiness in a fresh snapshot after any concurrent writers commit.
      const drafts = await tx.$queryRaw<{ id: string }[]>`
        SELECT b.id FROM batches b
        WHERE b."creatorId" = ${session.id} AND b.status = 'Draft' AND NOT b."itemReviewStarted"
        AND NOT EXISTS (SELECT 1 FROM pull_requests p WHERE p."batchId" = b.id)
        ORDER BY b.id FOR UPDATE OF b
      `
      if (!drafts.length) return { count: 0 }
      return tx.batch.deleteMany({
        where: {
          id: { in: drafts.map(draft => draft.id) },
          creatorId: session.id,
          status: 'Draft',
          itemReviewStarted: false,
          pullRequests: { none: {} },
        },
      })
    }, { isolationLevel: 'ReadCommitted' })
    return NextResponse.json({ deleted: deleted.count })
  } catch (error) {
    console.error('Delete empty drafts error:', error)
    return NextResponse.json({ error: '清理空草稿失败' }, { status: 500 })
  }
}
