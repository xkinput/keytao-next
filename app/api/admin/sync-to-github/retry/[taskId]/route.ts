/**
 * POST /api/admin/sync-to-github/retry/[taskId]
 * Retry a failed or cancelled sync task
 * Returns file list for frontend-controlled processing
 */

import { checkAdminPermission } from '@/lib/adminAuth';
import { prisma } from '@/lib/prisma';
import { convertToRimeDicts, generateSyncSummary } from '@/lib/services/rimeConverter';
import { SyncTaskStatus } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 10;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    // Verify admin permission
    const authResult = await checkAdminPermission();
    if (!authResult.authorized) {
      return authResult.response;
    }

    const { taskId } = await params;

    // Check if task exists and get batches
    const task = await prisma.syncTask.findUnique({
      where: { id: taskId },
      include: {
        batches: {
          include: {
            creator: {
              select: {
                id: true,
                name: true,
                nickname: true,
              },
            },
            pullRequests: {
              where: {
                status: 'Approved',
              },
              orderBy: {
                createAt: 'asc',
              },
            },
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

    const allPullRequests = task.batches.flatMap((batch) => batch.pullRequests);

    if (allPullRequests.length === 0) {
      return NextResponse.json(
        { success: false, error: '没有已批准的 Pull Request' },
        { status: 400 }
      );
    }

    console.log(`[Retry] Resetting task ${taskId}...`);

    // Convert to Rime format
    const dictFiles = convertToRimeDicts(allPullRequests);
    const fileNames = Array.from(dictFiles.keys());

    // Generate sync summary
    const summary = generateSyncSummary(allPullRequests, task.batches);

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

    console.log(`[Retry] Task ${taskId} reset, returning ${fileNames.length} files for frontend processing`);

    // Prepare file data for frontend
    const files = fileNames.map((fileName) => ({
      name: fileName,
      content: dictFiles.get(fileName)!,
    }));

    return NextResponse.json({
      success: true,
      taskId: task.id,
      files,
      summary,
      totalFiles: files.length,
      batchSize: 5,
    });
  } catch (error) {
    console.error('[Retry] Error:', error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '重试任务失败',
      },
      { status: 500 }
    );
  }
}
