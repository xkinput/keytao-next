/**
 * POST /api/admin/sync-to-github/trigger
 * Trigger a new sync task
 */

import { checkAdminPermission } from '@/lib/adminAuth';
import { createSyncTask, processSyncTaskBatch } from '@/lib/services/syncService';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 10; // Vercel Hobby limit

export async function POST(request: NextRequest) {
  try {
    // Verify admin permission
    const authResult = await checkAdminPermission();
    if (!authResult.authorized) {
      return authResult.response;
    }

    // Create sync task
    const taskId = await createSyncTask();

    console.log(`[Trigger] Created task ${taskId}, starting first batch...`);

    // Start first batch immediately in background
    // Don't await - let it run after response
    triggerNextBatch().catch((error) => {
      console.error('[Trigger] Failed to start first batch:', error);
    });

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

/**
 * Trigger next batch processing
 * This creates a chain of batch processing without cron
 */
async function triggerNextBatch() {
  try {
    const result = await processSyncTaskBatch();

    if (result.hasMore && result.taskId) {
      console.log(`[Trigger] Batch completed, triggering next batch for task ${result.taskId}`);

      // Chain the next batch by calling ourselves via HTTP
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'http://localhost:3000';

      // Fire and forget - don't wait for response
      fetch(`${baseUrl}/api/cron/sync-to-github`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${process.env.CRON_SECRET || 'internal'}`,
        },
      }).catch((error) => {
        console.error('[Trigger] Failed to chain next batch:', error);
      });
    } else {
      console.log('[Trigger] All batches completed or no more work');
    }
  } catch (error) {
    console.error('[Trigger] Error processing batch:', error);
  }
}
