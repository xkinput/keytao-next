/**
 * GET /api/admin/sync-to-github/tasks
 * List all sync tasks. Requires admin authentication.
 */

import { checkAdminPermission } from '@/lib/adminAuth';
import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const authResult = await checkAdminPermission();
    if (!authResult.authorized) return authResult.response!;

    // Get query parameters
    const { searchParams } = new URL(request.url);
    const page = Math.min(100, Math.max(1, parseInt(searchParams.get('page') || '1')));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '20')));
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
              creator: {
                select: {
                  id: true,
                  name: true,
                }
              }
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
          creator: batch.creator,
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
  } catch (error) {
    console.error('Failed to list sync tasks:', error);
    const message = error instanceof Error ? error.message : '获取同步任务列表失败';

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    );
  }
}
