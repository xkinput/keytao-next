/**
 * POST /api/admin/sync-to-github/retry/[taskId]
 * Retry a failed or cancelled sync task
 * Returns file list for frontend-controlled processing
 */

import { checkAdminPermission } from '@/lib/adminAuth';
import { prisma } from '@/lib/prisma';
import {
  convertPhrasesToRimeDicts,
  generateSyncSummary,
} from '@/lib/services/rimeConverter';
import { SyncTaskStatus, PhraseStatus } from '@prisma/client';
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
    const isManualSync = task.batches.length === 0;

    if (isManualSync) {
      console.log(`[Retry] Manual sync task ${taskId} - no batches`);
    } else {
      console.log(`[Retry] Task ${taskId} has ${task.batches.length} batches`);
    }

    const allPullRequests = task.batches.flatMap((batch) => batch.pullRequests);

    console.log(`[Retry] Resetting task ${taskId}...`);

    // Generate dictionary files from current Phrase table state (complete final state)
    // This ensures deleted items are removed and changed items are updated correctly
    console.log('[Retry] Generating dictionary from Phrase table...');

    const phrases = await prisma.phrase.findMany({
      where: {
        status: PhraseStatus.Finish,
      },
      orderBy: [
        { type: 'asc' },
        { code: 'asc' },
        { weight: 'asc' },
      ],
    });

    if (phrases.length === 0) {
      return NextResponse.json(
        { success: false, error: '词库中没有已完成的词条' },
        { status: 400 }
      );
    }

    const dictFiles = convertPhrasesToRimeDicts(phrases);

    if (dictFiles.size === 0) {
      return NextResponse.json(
        { success: false, error: '生成词典文件失败' },
        { status: 500 }
      );
    }

    const fileNames = Array.from(dictFiles.keys());
    console.log(`[Retry] Generated ${fileNames.length} dictionary files from ${phrases.length} phrases`);

    // Generate sync summary
    const summary = isManualSync
      ? `## 词库完整同步（重试）\n\n本次为管理员手动触发的完整词库同步。\n\n### 同步统计\n\n- 总计: **${phrases.length}** 条词条\n\n---\n\n_此PR由KeyTao管理系统自动生成_`
      : generateSyncSummary(allPullRequests, task.batches);
    console.log(`[Retry] Generated summary length: ${summary.length}`);
    console.log(`[Retry] Summary preview:\n${summary.slice(0, 300)}`);

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
