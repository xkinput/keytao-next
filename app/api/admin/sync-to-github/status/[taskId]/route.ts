/**
 * GET /api/admin/sync-to-github/status/[taskId]
 * Get sync task status
 */

import { checkAdminPermission } from '@/lib/adminAuth';
import { getSyncTaskStatus } from '@/lib/services/syncService';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: { taskId: string } }
) {
  try {
    // Verify admin permission
    const authResult = await checkAdminPermission();
    if (!authResult.authorized) {
      return authResult.response;
    }

    const { taskId } = params;

    const status = await getSyncTaskStatus(taskId);

    if (!status) {
      return NextResponse.json(
        {
          success: false,
          error: '任务不存在',
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: status,
    });
  } catch (error: any) {
    console.error('Failed to get sync status:', error);

    return NextResponse.json(
      {
        success: false,
        error: error.message || '获取同步状态失败',
      },
      { status: 500 }
    );
  }
}
