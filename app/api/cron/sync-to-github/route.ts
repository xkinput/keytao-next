/**
 * GET /api/cron/sync-to-github
 * Internal endpoint to process sync tasks in batches
 * Called by chain trigger mechanism (not scheduled cron)
 */

import { processSyncTaskBatch } from '@/lib/services/syncService';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 10; // Vercel Hobby limit

export async function GET(request: NextRequest) {
  console.log('[BatchProcessor] === Invocation started ===');

  try {
    // Verify secret (for security)
    const authHeader = request.headers.get('authorization');
    const secret = process.env.CRON_SECRET || 'internal';

    if (authHeader !== `Bearer ${secret}`) {
      console.error('[BatchProcessor] Unauthorized access attempt');
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Process multiple batches in a loop (up to a limit)
    let batchCount = 0;
    const maxBatchesPerInvocation = 3;
    let lastResult: { hasMore: boolean; taskId?: string } = { hasMore: false };

    while (batchCount < maxBatchesPerInvocation) {
      console.log(`[BatchProcessor] Processing batch #${batchCount + 1}...`);

      const result = await processSyncTaskBatch();

      if (!result.taskId) {
        console.log('[BatchProcessor] No active tasks to process');
        break;
      }

      console.log(`[BatchProcessor] Batch #${batchCount + 1} completed for task ${result.taskId}, hasMore: ${result.hasMore}`);
      lastResult = result;

      if (!result.hasMore) {
        console.log('[BatchProcessor] Task completed!');
        break;
      }

      batchCount++;
    }

    // If more work remains after hitting the limit, trigger another invocation
    if (lastResult.hasMore && batchCount >= maxBatchesPerInvocation) {
      console.log('[BatchProcessor] Hit batch limit, triggering next invocation...');

      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

      // Fire and forget - chain the next batch
      fetch(`${baseUrl}/api/cron/sync-to-github`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${secret}`,
        },
      }).catch((error) => {
        console.error('[BatchProcessor] Failed to chain next invocation:', error);
      });
    }

    console.log('[BatchProcessor] === Invocation completed ===');

    return NextResponse.json({
      success: true,
      batchesProcessed: batchCount,
      taskId: lastResult.taskId,
      hasMore: lastResult.hasMore,
      message: batchCount === 0
        ? 'No active tasks'
        : lastResult.hasMore
          ? `Processed ${batchCount} batches, more work remaining`
          : 'Task completed',

    } catch (error: any) {
      console.error('[BatchProcessor] Error:', error);

      return NextResponse.json(
        {
          success: false,
          error: error.message || 'Unknown error',
        },
        { status: 500 }
      );
    }
  }
