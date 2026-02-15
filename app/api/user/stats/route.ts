import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.id

    // Get batches count
    const batchesCount = await prisma.batch.count({
      where: { creatorId: userId }
    })

    // Get pull requests count
    const pullRequestsCount = await prisma.pullRequest.count({
      where: { userId }
    })

    // Get batches by status
    const batchesByStatus = await prisma.batch.groupBy({
      by: ['status'],
      where: { creatorId: userId },
      _count: true
    })

    // Get pull requests by status
    const pullRequestsByStatus = await prisma.pullRequest.groupBy({
      by: ['status'],
      where: { userId },
      _count: true
    })

    // Get recent batches
    const recentBatches = await prisma.batch.findMany({
      where: { creatorId: userId },
      orderBy: { createAt: 'desc' },
      take: 5,
      select: {
        id: true,
        description: true,
        status: true,
        createAt: true,
        _count: {
          select: {
            pullRequests: true
          }
        }
      }
    })

    return NextResponse.json({
      batchesCount,
      pullRequestsCount,
      batchesByStatus: batchesByStatus.reduce((acc, item) => {
        acc[item.status] = item._count
        return acc
      }, {} as Record<string, number>),
      pullRequestsByStatus: pullRequestsByStatus.reduce((acc, item) => {
        acc[item.status] = item._count
        return acc
      }, {} as Record<string, number>),
      recentBatches
    })
  } catch (error) {
    console.error('Get user stats error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
