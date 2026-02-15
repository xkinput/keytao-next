/**
 * GET /api/cron/sync-to-github
 * Cron job to automatically sync dictionaries every 3 days
 */

import { createSyncTask } from '@/lib/services/syncService';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  try {
    // Verify cron secret (for security)
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    console.log('Cron job triggered: sync-to-github');

    // Create and start sync task
    const taskId = await createSyncTask();

    console.log(`Sync task created: ${taskId}`);

    return NextResponse.json({
      success: true,
      taskId,
      message: 'Sync task created successfully',
    });
  } catch (error: any) {
    console.error('Cron job failed:', error);

    // If no batches to sync, return success (not an error)
    if (error.message === 'No batches to sync') {
      return NextResponse.json({
        success: true,
        message: 'No batches to sync',
      });
    }

    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to create sync task',
      },
      { status: 500 }
    );
  }
}
