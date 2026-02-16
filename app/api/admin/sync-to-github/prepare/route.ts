/**
 * POST /api/admin/sync-to-github/prepare
 * Prepare sync task and return file list for frontend processing
 */

import { checkAdminPermission } from '@/lib/adminAuth';
import { prisma } from '@/lib/prisma';
import {
  convertPhrasesToRimeDicts,
  generateSyncSummary,
} from '@/lib/services/rimeConverter';
import { SyncTaskStatus, PhraseStatus } from '@prisma/client';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 10;

export async function POST() {
  try {
    // Verify admin permission
    const authResult = await checkAdminPermission();
    if (!authResult.authorized) {
      return authResult.response;
    }

    console.log('[Prepare] Creating sync task...');

    // Find approved batches (optional - can sync without batches)
    const batches = await prisma.batch.findMany({
      where: {
        status: 'Approved',
        syncTaskId: null,
      },
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
    });

    const allPullRequests = batches.flatMap((batch) => batch.pullRequests);

    // Allow manual sync even without batches
    const isManualSync = batches.length === 0;

    if (isManualSync) {
      console.log('[Prepare] Manual sync triggered - no pending batches');
    } else {
      console.log(`[Prepare] Found ${batches.length} batches with ${allPullRequests.length} pull requests`);
    }

    // Generate dictionary files from current Phrase table state (complete final state)
    // This ensures deleted items are removed and changed items are updated correctly
    console.log('[Prepare] Generating dictionary from Phrase table...');

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
    console.log(`[Prepare] Generated ${fileNames.length} dictionary files from ${phrases.length} phrases`);

    // Generate sync summary
    const summary = isManualSync
      ? `## 词库完整同步\n\n本次为管理员手动触发的完整词库同步。\n\n### 同步统计\n\n- 总计: **${phrases.length}** 条词条\n\n---\n\n_此PR由KeyTao管理系统自动生成_`
      : generateSyncSummary(allPullRequests, batches);
    console.log(`[Prepare] Generated summary length: ${summary.length}`);

    // Create task
    const task = await prisma.syncTask.create({
      data: {
        status: SyncTaskStatus.Pending,
        totalItems: allPullRequests.length || phrases.length,
        batches: batches.length > 0 ? {
          connect: batches.map((batch) => ({ id: batch.id })),
        } : undefined,
      },
    });

    console.log(`[Prepare] Task ${task.id} created with ${fileNames.length} files${isManualSync ? ' (manual sync)' : ''}`);

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
    console.error('[Prepare] Error:', error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '准备同步任务失败',
      },
      { status: 500 }
    );
  }
}