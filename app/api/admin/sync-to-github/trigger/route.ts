/**
 * POST /api/admin/sync-to-github/trigger
 * Trigger a new sync task
 */

import { checkAdminPermission } from '@/lib/adminAuth';
import { createSyncTask } from '@/lib/services/syncService';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes for Pro plan

export async function POST(request: NextRequest) {
  try {
    // Verify admin permission
    const authResult = await checkAdminPermission();
    if (!authResult.authorized) {
      return authResult.response;
    }

    // Create and start sync task
    const taskId = await createSyncTask();

    return NextResponse.json({
      success: true,
      taskId,
      message: '同步任务已创建并开始执行',
    });
  } catch (error: any) {
    console.error('Failed to trigger sync:', error);

    if (error.message === 'No batches to sync') {
      return NextResponse.json(
        {
          success: false,
          error: '没有需要同步的批次',
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: error.message || '创建同步任务失败',
      },
      { status: 500 }
    );
  }
}
