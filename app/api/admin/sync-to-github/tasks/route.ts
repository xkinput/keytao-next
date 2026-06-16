/**
 * GET /api/admin/sync-to-github/tasks
 * List all sync tasks. Requires admin authentication.
 */

import { checkAdminPermission } from '@/lib/adminAuth';
import { listSyncTasks } from '@/lib/services/syncTaskListService';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const authResult = await checkAdminPermission();
    if (!authResult.authorized) return authResult.response!;

    return listSyncTasks(request);
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
