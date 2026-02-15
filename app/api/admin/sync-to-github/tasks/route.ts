/**
 * GET /api/admin/sync-to-github/tasks
 * List all sync tasks
 */

import { checkAdminPermission } from '@/lib/adminAuth';
import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    // Verify admin permission
    const authResult = await checkAdminPermission();
    if (!authResult.authorized) {
      return authResult.response;
    }

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
            },
          },
        },
      }),
      prisma.syncTask.count(),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        tasks,
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        },
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
