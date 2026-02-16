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

    console.log(`[Trigger] Created task ${taskId}, processing first batch immediately...`);

    // Process first batch immediately (don't wait for response)
    // This ensures at least the first batch starts before function terminates
    processFirstBatch().catch((error) => {
      console.error('[Trigger] Failed to process first batch:', error);
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
 * Process first batch and chain subsequent batches
 * Uses recursive processing to avoid HTTP overhead
 */
async function processFirstBatch() {
  try {
    console.log('[Trigger] Starting batch processing chain...');

    // Process batches in a loop until done or timeout
    let batchCount = 0;
    const maxBatchesPerInvocation = 3; // Process up to 3 batches per trigger (safety limit)

    while (batchCount < maxBatchesPerInvocation) {
      console.log(`[Trigger] Processing batch #${batchCount + 1}...`);

      const result = await processSyncTaskBatch();

      if (!result.taskId) {
        console.log('[Trigger] No active tasks found');
        break;
      }

      console.log(`[Trigger] Batch #${batchCount + 1} completed for task ${result.taskId}, hasMore: ${result.hasMore}`);

      if (!result.hasMore) {
        console.log('[Trigger] All batches completed!');
        break;
      }

      batchCount++;
    }

    // If we hit the limit and there's still more work, trigger via HTTP
    if (batchCount >= maxBatchesPerInvocation) {
      console.log('[Trigger] Hit batch limit, triggering continuation via HTTP...');
      await triggerContinuation();
    }
  } catch (error) {
    console.error('[Trigger] Error in batch processing chain:', error);
  }
}

/**
 * Trigger continuation via HTTP for remaining work
 */
async function triggerContinuation() {
  try {
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

    console.log(`[Trigger] Calling continuation URL: ${baseUrl}/api/cron/sync-to-github`);

    const response = await fetch(`${baseUrl}/api/cron/sync-to-github`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.CRON_SECRET || 'internal'}`,
      },
    });

    if (!response.ok) {
      console.error(`[Trigger] Continuation call failed: ${response.status} ${response.statusText}`);
    } else {
      console.log('[Trigger] Continuation triggered successfully');
    }
  } catch (error) {
    console.error('[Trigger] Failed to trigger continuation:', error);
  }
}
