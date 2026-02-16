/**
 * GET /api/admin/sync-to-github/tasks
 * List all sync tasks (publicly accessible, no authentication required)
 */

import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    // No authentication required - allow public access to view sync history

    // Get query parameters
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '20');
    const skip = (page - 1) * pageSize;

    // Query tasks
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
            },
          },
        },
      }),
      prisma.syncTask.count(),
    ]);

    // Add statistics to each task
    const tasksWithStats = tasks.map(task => {
      let totalAdds = 0;
      let totalChanges = 0;
      let totalDeletes = 0;

      const batchesWithStats = task.batches.map(batch => {
        const stats = {
          add: batch.pullRequests.filter(pr => pr.action === 'Create').length,
          change: batch.pullRequests.filter(pr => pr.action === 'Change').length,
          delete: batch.pullRequests.filter(pr => pr.action === 'Delete').length,
        };

        totalAdds += stats.add;
        totalChanges += stats.change;
        totalDeletes += stats.delete;

        return {
          id: batch.id,
          description: batch.description,
          stats,
          totalPullRequests: batch.pullRequests.length,
        };
      });

      return {
        ...task,
        batches: batchesWithStats,
        totalStats: {
          add: totalAdds,
          change: totalChanges,
          delete: totalDeletes,
          total: totalAdds + totalChanges + totalDeletes,
        },
      };
    });

    return NextResponse.json({
      tasks: tasksWithStats,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error: any) {
    console.error('Failed to list sync tasks:', error);

    return NextResponse.json(
      {
        success: false,
        error: error.message || '获取同步任务列表失败',
      },
      { status: 500 }
    );
  }
}
