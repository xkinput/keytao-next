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

    // Find approved batches
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

    if (batches.length === 0) {
      return NextResponse.json(
        { success: false, error: '没有需要同步的批次' },
        { status: 400 }
      );
    }

    const allPullRequests = batches.flatMap((batch) => batch.pullRequests);

    if (allPullRequests.length === 0) {
      return NextResponse.json(
        { success: false, error: '没有已批准的 Pull Request' },
        { status: 400 }
      );
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
    const summary = generateSyncSummary(allPullRequests, batches);
    console.log(`[Prepare] Generated summary length: ${summary.length}`);
    console.log(`[Prepare] Summary preview:\n${summary.slice(0, 300)}`);

    // Create task
    const task = await prisma.syncTask.create({
      data: {
        status: SyncTaskStatus.Pending,
        totalItems: allPullRequests.length,
        batches: {
          connect: batches.map((batch) => ({ id: batch.id })),
        },
      },
    });

    console.log(`[Prepare] Task ${task.id} created with ${fileNames.length} files`);

    // Prepare file data for frontend
    const files = fileNames.map((fileName) => ({
      name: fileName,
      content: mergedDictFiles.get(fileName)!,
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
d