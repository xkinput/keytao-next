/**
 * POST /api/admin/sync-to-github/prepare
 * Prepare sync task and return file list for frontend processing
 */

import { checkAdminPermission } from '@/lib/adminAuth';
import { prisma } from '@/lib/prisma';
import { convertToRimeDicts, generateSyncSummary } from '@/lib/services/rimeConverter';
import { SyncTaskStatus } from '@prisma/client';
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

    // Convert to Rime format
    const dictFiles = convertToRimeDicts(allPullRequests);
    const fileNames = Array.from(dictFiles.keys());

    // Generate sync summary
    const summary = generateSyncSummary(allPullRequests, batches);

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
