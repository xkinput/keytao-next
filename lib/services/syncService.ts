/**
 * Sync Service
 * Main service for orchestrating dictionary synchronization
 */

import { prisma } from '@/lib/prisma';
import { BatchStatus, SyncTaskStatus } from '@prisma/client';
import { convertToRimeDicts, generateSyncSummary } from './rimeConverter';
import { createGithubSyncService } from './githubSync';

/**
 * Update sync task progress
 */
async function updateProgress(
  taskId: string,
  progress: number,
  message: string
) {
  await prisma.syncTask.update({
    where: { id: taskId },
    data: { progress, message },
  });
}

/**
 * Execute sync task
 * This runs asynchronously and updates the task status in database
 */
export async function executeSyncTask(taskId: string): Promise<void> {
  try {
    // Mark as running
    await prisma.syncTask.update({
      where: { id: taskId },
      data: {
        status: SyncTaskStatus.Running,
        startedAt: new Date(),
        message: '开始同步...',
      },
    });

    // Step 1: Load task with batches and pull requests
    await updateProgress(taskId, 10, '加载待同步数据...');
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
            },
          },
        },
      },
    });

    if (!task) {
      throw new Error('Sync task not found');
    }

    // Collect all pull requests from batches
    const allPullRequests = task.batches.flatMap((batch) => batch.pullRequests);

    if (allPullRequests.length === 0) {
      throw new Error('No approved pull requests to sync');
    }

    // Step 2: Convert to Rime format
    await updateProgress(taskId, 30, '转换为Rime格式...');
    const dictFiles = convertToRimeDicts(allPullRequests);

    if (dictFiles.size === 0) {
      throw new Error('No dictionary files generated');
    }

    // Step 3: Generate summary
    await updateProgress(taskId, 50, '生成同步说明...');
    const summary = generateSyncSummary(allPullRequests, task.batches);

    // Step 4: Sync to Github
    await updateProgress(taskId, 60, '连接Github...');
    const githubService = createGithubSyncService();

    await updateProgress(taskId, 70, '创建分支和提交文件...');
    const pr = await githubService.syncDictionaries(dictFiles, summary);

    await updateProgress(taskId, 90, '创建Pull Request...');

    // Step 5: Mark as completed
    await prisma.syncTask.update({
      where: { id: taskId },
      data: {
        status: SyncTaskStatus.Completed,
        progress: 100,
        message: '同步完成',
        completedAt: new Date(),
        githubPrUrl: pr.html_url,
        githubPrNumber: pr.number,
        githubBranch: pr.branch,
        processedItems: task.totalItems,
      },
    });

    console.log(`Sync task ${taskId} completed successfully`);
  } catch (error: any) {
    console.error(`Sync task ${taskId} failed:`, error);

    // Mark as failed
    await prisma.syncTask.update({
      where: { id: taskId },
      data: {
        status: SyncTaskStatus.Failed,
        error: error.message || 'Unknown error',
        completedAt: new Date(),
      },
    });
  }
}

/**
 * Create and trigger a new sync task
 */
export async function createSyncTask(): Promise<string> {
  // Find all approved batches that haven't been synced
  const batches = await prisma.batch.findMany({
    where: {
      status: BatchStatus.Approved,
      syncTaskId: null,
    },
    include: {
      pullRequests: {
        where: {
          status: 'Approved',
        },
      },
    },
  });

  if (batches.length === 0) {
    throw new Error('No batches to sync');
  }

  // Count total items
  const totalItems = batches.reduce(
    (sum, batch) => sum + batch.pullRequests.length,
    0
  );

  // Create sync task
  const task = await prisma.syncTask.create({
    data: {
      status: SyncTaskStatus.Pending,
      totalItems,
      batches: {
        connect: batches.map((b) => ({ id: b.id })),
      },
    },
  });

  // Start execution in background
  executeSyncTask(task.id).catch((error) => {
    console.error('Failed to start sync task:', error);
  });

  return task.id;
}

/**
 * Get sync task status
 */
export async function getSyncTaskStatus(taskId: string) {
  const task = await prisma.syncTask.findUnique({
    where: { id: taskId },
    include: {
      batches: {
        select: {
          id: true,
          description: true,
          status: true,
        },
      },
    },
  });

  if (!task) {
    return null;
  }

  return {
    id: task.id,
    status: task.status,
    progress: task.progress,
    message: task.message,
    error: task.error,
    batchCount: task.batches.length,
    processedItems: task.processedItems,
    totalItems: task.totalItems,
    githubPrUrl: task.githubPrUrl,
    githubPrNumber: task.githubPrNumber,
    githubBranch: task.githubBranch,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    batches: task.batches,
  };
}
