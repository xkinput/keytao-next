/**
 * POST /api/admin/sync-to-github/commit-batch
 * Commit a batch of files to GitHub
 */

import { checkAdminPermission } from '@/lib/adminAuth';
import { prisma } from '@/lib/prisma';
import { createGithubSyncService } from '@/lib/services/githubSync';
import { SyncTaskStatus } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 10;

interface CommitBatchRequest {
  taskId: string;
  files: Array<{ name: string; content: string }>;
  processedCount: number;
  totalCount: number;
}

export async function POST(request: NextRequest) {
  try {
    // Verify admin permission
    const authResult = await checkAdminPermission();
    if (!authResult.authorized) {
      return authResult.response;
    }

    const body: CommitBatchRequest = await request.json();
    const { taskId, files, processedCount, totalCount } = body;

    console.log(`[CommitBatch] Task ${taskId}: committing ${files.length} files (${processedCount}/${totalCount})`);

    // Check if task exists and is valid
    const task = await prisma.syncTask.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        status: true,
        githubBranch: true,
        processedFiles: true,
        pendingFiles: true,
      },
    });

    if (!task) {
      return NextResponse.json(
        { success: false, error: '任务不存在' },
        { status: 404 }
      );
    }

    if (task.status === SyncTaskStatus.Cancelled) {
      return NextResponse.json(
        { success: false, error: '任务已取消' },
        { status: 400 }
      );
    }

    // Update task status to Running if it's Pending
    if (task.status === SyncTaskStatus.Pending) {
      await prisma.syncTask.update({
        where: { id: taskId },
        data: {
          status: SyncTaskStatus.Running,
          startedAt: new Date(),
          message: '开始提交文件...',
        },
      });
    }

    const githubService = createGithubSyncService();
    let branch = task.githubBranch;

    // Create branch if not exists
    if (!branch) {
      console.log(`[CommitBatch] Creating GitHub branch for task ${taskId}`);
      branch = githubService.generateBranchName(taskId);
      await githubService.getOrCreateBranch(branch);

      await prisma.syncTask.update({
        where: { id: taskId },
        data: { githubBranch: branch },
      });

      console.log(`[CommitBatch] Branch created: ${branch}`);
    }

    const fileCommits = files.map((file) => ({
      path: `rime/${file.name}`,
      content: file.content,
    }));
    const changedFiles = await githubService.filterChangedFiles(branch, fileCommits);

    // Commit files
    const commitMessage = `Update dictionaries - ${new Date().toISOString().split('T')[0]}`;

    if (changedFiles.length > 0) {
      console.log(`[CommitBatch] Committing ${changedFiles.length} files in one commit`);
      await githubService.commitFiles(branch, changedFiles, commitMessage);
    } else {
      console.log('[CommitBatch] No content changes detected on branch, skipping commit');
    }

    // Calculate progress
    const progress = Math.floor((processedCount / totalCount) * 90); // 0-90%
    const processedFileNames = Array.from(
      new Set([
        ...task.processedFiles,
        ...files.map((file) => file.name),
      ])
    );
    const pendingFileNames = task.pendingFiles.filter(
      (fileName) => !files.some((file) => file.name === fileName)
    );

    // Update task progress
    await prisma.syncTask.update({
      where: { id: taskId },
      data: {
        progress,
        message: `已提交 ${processedCount}/${totalCount} 个文件`,
        processedItems: processedCount,
        processedFiles: processedFileNames,
        pendingFiles: pendingFileNames,
      },
    });

    console.log(`[CommitBatch] Task ${taskId}: batch committed successfully, progress: ${progress}%`);

    return NextResponse.json({
      success: true,
      progress,
      message: `已提交 ${processedCount}/${totalCount} 个文件`,
      branch, // Return branch name for UI display
      processedCount,
    });
  } catch (error) {
    console.error('[CommitBatch] Error:', error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '提交文件失败',
      },
      { status: 500 }
    );
  }
}
