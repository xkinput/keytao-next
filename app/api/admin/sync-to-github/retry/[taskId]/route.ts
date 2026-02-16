/**
 * POST /api/admin/sync-to-github/retry/[taskId]
 * Retry a failed or cancelled sync task
 */

import { checkAdminPermission } from '@/lib/adminAuth';
import { prisma } from '@/lib/prisma';
import { processSyncTaskBatch } from '@/lib/services/syncService';
import { SyncTaskStatus } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 10;

export async function POST(
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

    // Check if task exists
    const task = await prisma.syncTask.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        status: true,
        batches: {
          select: {
            id: true,
          },
        },
      },
    });

    if (!task) {
      return NextResponse.json(
        { success: false, error: '任务不存在' },
        { status: 404 }
      );
    }

    // Only allow retry for Failed or Cancelled tasks
    if (task.status !== SyncTaskStatus.Failed && task.status !== SyncTaskStatus.Cancelled) {
      return NextResponse.json(
        {
          success: false,
          error: `只能重试失败或已取消的任务，当前状态: ${task.status}`,
        },
        { status: 400 }
      );
    }

    // Check if task has batches
    if (task.batches.length === 0) {
      return NextResponse.json(
        { success: false, error: '任务没有关联的批次' },
        { status: 400 }
      );
    }

    console.log(`[Retry] Resetting task ${taskId}...`);

    // Reset task to Pending state
    await prisma.syncTask.update({
      where: { id: taskId },
      data: {
        status: SyncTaskStatus.Pending,
        progress: 0,
        message: '等待重试...',
        error: null,
        startedAt: null,
        completedAt: null,
        githubPrUrl: null,
        githubPrNumber: null,
        githubBranch: null,
        processedFiles: [],
        pendingFiles: [],
        processedItems: 0,
      },
    });

    console.log(`[Retry] Task ${taskId} reset to Pending, starting first batch...`);

    // Start first batch immediately in background
    triggerFirstBatch().catch((error) => {
      console.error('[Retry] Failed to start first batch:', error);
    });

    return NextResponse.json({
      success: true,
      message: '任务已重置并开始重试',
    });
  } catch (error) {
    console.error('Failed to retry task:', error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '重试任务失败',
      },
      { status: 500 }
    );
  }
}

/**
 * Trigger first batch processing
 */
async function triggerFirstBatch() {
  try {
    const result = await processSyncTaskBatch();

    if (result.hasMore && result.taskId) {
      console.log(`[Retry] First batch completed, triggering next batch for task ${result.taskId}`);

      // Chain the next batch
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'http://localhost:3000';

      fetch(`${baseUrl}/api/cron/sync-to-github`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${process.env.CRON_SECRET || 'internal'}`,
        },
      }).catch((error) => {
        console.error('[Retry] Failed to chain next batch:', error);
      });
    }
  } catch (error) {
    console.error('[Retry] Error processing first batch:', error);
  }
}
