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
  console.log('[BatchProcessor] Processing next batch...');

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

    // Process one batch of files
    const result = await processSyncTaskBatch();

    if (!result.taskId) {
      console.log('[BatchProcessor] No active tasks to process');
      return NextResponse.json({
        success: true,
        message: 'No active tasks',
      });
    }

    console.log(`[BatchProcessor] Processed task ${result.taskId}, hasMore: ${result.hasMore}`);

    // If more work remains, trigger next batch
    if (result.hasMore) {
      console.log('[BatchProcessor] Triggering next batch...');

      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'http://localhost:3000';

      // Fire and forget - chain the next batch
      fetch(`${baseUrl}/api/cron/sync-to-github`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${secret}`,
        },
      }).catch((error) => {
        console.error('[BatchProcessor] Failed to chain next batch:', error);
      });
    }

    return NextResponse.json({
      success: true,
      taskId: result.taskId,
      hasMore: result.hasMore,
      message: result.hasMore
        ? 'Batch processed, next batch triggered'
        : 'Task completed',
    });

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
