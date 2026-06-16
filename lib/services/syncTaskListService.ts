import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

function readPositiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number.parseInt(value || '', 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(1, parsed))
}

export async function listSyncTasks(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const page = readPositiveInt(searchParams.get('page'), 1, 100)
  const pageSize = readPositiveInt(searchParams.get('pageSize'), 20, 100)
  const skip = (page - 1) * pageSize

  const [tasks, total] = await Promise.all([
    prisma.syncTask.findMany({
      skip,
      take: pageSize,
      orderBy: {
        createAt: 'desc',
      },
      include: {
        batches: {
          select: {
            id: true,
            description: true,
            pullRequests: {
              select: {
                id: true,
                action: true,
              },
            },
            creator: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    }),
    prisma.syncTask.count(),
  ])

  const tasksWithStats = tasks.map(task => {
    let totalAdds = 0
    let totalChanges = 0
    let totalDeletes = 0

    const batchesWithStats = task.batches.map(batch => {
      const stats = {
        add: batch.pullRequests.filter(pr => pr.action === 'Create').length,
        change: batch.pullRequests.filter(pr => pr.action === 'Change').length,
        delete: batch.pullRequests.filter(pr => pr.action === 'Delete').length,
      }

      totalAdds += stats.add
      totalChanges += stats.change
      totalDeletes += stats.delete

      return {
        id: batch.id,
        description: batch.description,
        stats,
        creator: batch.creator,
        totalPullRequests: batch.pullRequests.length,
      }
    })

    return {
      id: task.id,
      status: task.status,
      progress: task.progress,
      message: task.message,
      error: task.error,
      githubPrUrl: task.githubPrUrl,
      createAt: task.createAt,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      batches: batchesWithStats,
      totalStats: {
        add: totalAdds,
        change: totalChanges,
        delete: totalDeletes,
        total: totalAdds + totalChanges + totalDeletes,
      },
    }
  })

  return NextResponse.json({
    tasks: tasksWithStats,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  })
}
