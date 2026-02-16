/**
 * Sync Service
 * Main service for orchestrating dictionary synchronization
 * Optimized for Vercel Hobby plan (10s timeout) with batch processing
 */

import { prisma } from '@/lib/prisma';
import { BatchStatus, SyncTaskStatus } from '@prisma/client';
import { convertToRimeDicts, generateSyncSummary } from './rimeConverter';
import { createGithubSyncService } from './githubSync';

// How many files to process in one batch (adjust based on timeout)
const FILES_PER_BATCH = 5;

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
 * Check if task has been cancelled
 * @throws Error if task is cancelled
 */
async function checkCancellation(taskId: string): Promise<void> {
  const task = await prisma.syncTask.findUnique({
    where: { id: taskId },
    select: { status: true }
  });

  if (task?.status === SyncTaskStatus.Cancelled) {
    throw new Error('Task cancelled by user');
  }
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
    await checkCancellation(taskId);

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
      throw new Error('Sync task not found');
    }

    // Collect all pull requests from batches
    const allPullRequests = task.batches.flatMap((batch) => batch.pullRequests);

    if (allPullRequests.length === 0) {
      throw new Error('No approved pull requests to sync');
    }

    // Step 2: Convert to Rime format
    await updateProgress(taskId, 30, '转换为Rime格式...');
    await checkCancellation(taskId);

    const dictFiles = convertToRimeDicts(allPullRequests);

    if (dictFiles.size === 0) {
      throw new Error('No dictionary files generated');
    }

    // Step 3: Generate summary
    await updateProgress(taskId, 50, '生成同步说明...');
    await checkCancellation(taskId);

    const summary = generateSyncSummary(allPullRequests, task.batches);

    // Step 4: Sync to Github
    await updateProgress(taskId, 60, '连接Github...');
    await checkCancellation(taskId);

    const githubService = createGithubSyncService();

    await updateProgress(taskId, 70, '创建分支和提交文件...');
    await checkCancellation(taskId);

    // Pass progress callback to show file commit progress
    const pr = await githubService.syncDictionaries(
      dictFiles,
      summary,
      async (current, total) => {
        // Check cancellation during file commits
        await checkCancellation(taskId);

        // Calculate progress between 70% and 90% based on files committed
        const fileProgress = (current / total) * 20  // 20% range for file commits
        const overallProgress = 70 + fileProgress
        await updateProgress(
          taskId,
          Math.floor(overallProgress),
          `提交文件 ${current}/${total}...`
        )
      }
    );

    await updateProgress(taskId, 90, '创建Pull Request...');
    await checkCancellation(taskId);

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
  } catch (error) {
    console.error(`Sync task ${taskId} error:`, error);

    // Check if task was cancelled
    const errorMessage = error instanceof Error ? error.message : String(error)
    const isCancelled = errorMessage === 'Task cancelled by user';

    // Mark as cancelled or failed
    await prisma.syncTask.update({
      where: { id: taskId },
      data: {
        status: isCancelled ? SyncTaskStatus.Cancelled : SyncTaskStatus.Failed,
        error: errorMessage || 'Unknown error',
        completedAt: new Date(),
      },
    });
  }
}

/**
 * Create and trigger a new sync task
 */
export async function createSyncTask(): Promise<string> {
  console.log('[SyncTask] Creating new sync task...');

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
        orderBy: {
          createAt: 'asc',
        },
      },
    },
  });

  if (batches.length === 0) {
    console.log('[SyncTask] No batches to sync');
    throw new Error('No batches to sync');
  }

  // Count total items
  const totalItems = batches.reduce(
    (sum, batch) => sum + batch.pullRequests.length,
    0
  );

  console.log(`[SyncTask] Found ${batches.length} batches with ${totalItems} items`);

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

  console.log(`[SyncTask] Created task ${task.id}`);

  // For Hobby plan: Don't start execution here
  // It will be picked up by the cron job

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

/**
 * Process one batch of files for a sync task (called by cron job)
 * Returns true if there's more work to do
 */
export async function processSyncTaskBatch(): Promise<{ hasMore: boolean; taskId?: string }> {
  console.log('[SyncTask] Processing batch...');

  // Find a task that needs processing
  const task = await prisma.syncTask.findFirst({
    where: {
      OR: [
        { status: SyncTaskStatus.Pending },
        { status: SyncTaskStatus.Running },
      ],
    },
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
    orderBy: {
      createAt: 'asc', // Process oldest first
    },
  });

  if (!task) {
    console.log('[SyncTask] No tasks to process');
    return { hasMore: false };
  }

  console.log(`[SyncTask] Processing task ${task.id}, status: ${task.status}`);

  try {
    // Mark as running if pending
    if (task.status === SyncTaskStatus.Pending) {
      await prisma.syncTask.update({
        where: { id: task.id },
        data: {
          status: SyncTaskStatus.Running,
          startedAt: new Date(),
          message: '开始处理...',
        },
      });
      console.log(`[SyncTask] ${task.id} marked as Running`);
    }

    // Check cancellation
    await checkCancellation(task.id);

    // Collect all pull requests
    const allPullRequests = task.batches.flatMap((batch) => batch.pullRequests);

    if (allPullRequests.length === 0) {
      throw new Error('No approved pull requests to sync');
    }

    // If this is the first run, prepare files
    if (task.pendingFiles.length === 0 && task.processedFiles.length === 0) {
      console.log(`[SyncTask] ${task.id} - Preparing files...`);

      await updateProgress(task.id, 10, '转换为Rime格式...');
      const dictFiles = convertToRimeDicts(allPullRequests);

      if (dictFiles.size === 0) {
        throw new Error('No dictionary files generated');
      }

      const fileList: string[] = Array.from(dictFiles.keys());
      console.log(`[SyncTask] ${task.id} - Total files to process: ${fileList.length}`);

      // Store files and metadata in database
      await prisma.syncTask.update({
        where: { id: task.id },
        data: {
          pendingFiles: fileList,
          processedFiles: [],
        },
      });

      await updateProgress(task.id, 20, '生成同步说明...');
      const summary = generateSyncSummary(allPullRequests, task.batches);

      // Store summary in error field temporarily (we'll use it later)
      await prisma.syncTask.update({
        where: { id: task.id },
        data: {
          error: `SUMMARY:${summary}`, // Temporary storage
        },
      });

      console.log(`[SyncTask] ${task.id} - Initialized with ${fileList.length} files`);
    }

    // Reload task to get updated state
    const updatedTask = await prisma.syncTask.findUnique({
      where: { id: task.id },
      select: {
        id: true,
        pendingFiles: true,
        processedFiles: true,
        githubBranch: true,
        error: true,
      },
    });

    if (!updatedTask) {
      throw new Error('Task not found after update');
    }

    const { pendingFiles, processedFiles, githubBranch } = updatedTask;

    // Get files to process in this batch
    const filesToProcess = pendingFiles.slice(0, FILES_PER_BATCH);
    const remainingFiles = pendingFiles.slice(FILES_PER_BATCH);

    if (filesToProcess.length === 0) {
      // All files processed, create PR
      console.log(`[SyncTask] ${task.id} - All files processed, creating PR...`);

      await updateProgress(task.id, 90, '创建Pull Request...');

      const githubService = createGithubSyncService();
      const summary = updatedTask.error?.startsWith('SUMMARY:')
        ? updatedTask.error.substring(8)
        : '词库同步更新';

      const pr = await githubService.createPullRequest(
        githubBranch!,
        `[自动同步] 词库更新 - ${new Date().toLocaleDateString('zh-CN')}`,
        summary
      );

      // Mark as completed
      await prisma.syncTask.update({
        where: { id: task.id },
        data: {
          status: SyncTaskStatus.Completed,
          progress: 100,
          message: '同步完成',
          completedAt: new Date(),
          githubPrUrl: pr.html_url,
          githubPrNumber: pr.number,
          error: null, // Clear temporary summary
          processedItems: task.totalItems,
        },
      });

      console.log(`[SyncTask] ${task.id} - Completed! PR: ${pr.html_url}`);
      return { hasMore: false, taskId: task.id };
    }

    // Process batch of files
    console.log(`[SyncTask] ${task.id} - Processing ${filesToProcess.length} files...`);

    await checkCancellation(task.id);

    const githubService = createGithubSyncService();
    let branch = githubBranch;

    // Create branch if not exists
    if (!branch) {
      await updateProgress(task.id, 30, '创建GitHub分支...');
      branch = githubService.generateBranchName();
      await githubService.getOrCreateBranch(branch);

      await prisma.syncTask.update({
        where: { id: task.id },
        data: { githubBranch: branch },
      });

      console.log(`[SyncTask] ${task.id} - Created branch: ${branch}`);
    }

    // Regenerate dict files for this batch
    const dictFiles = convertToRimeDicts(allPullRequests);

    // Commit this batch of files
    const commitMessage = `Update dictionaries - ${new Date().toISOString().split('T')[0]}`;

    for (const fileName of filesToProcess) {
      await checkCancellation(task.id);

      const content = dictFiles.get(fileName);
      if (!content) {
        console.warn(`[SyncTask] ${task.id} - File ${fileName} not found in dictFiles`);
        continue;
      }

      await githubService.commitFiles(
        branch,
        [{ path: `rime/${fileName}`, content }],
        commitMessage
      );

      console.log(`[SyncTask] ${task.id} - Committed file: ${fileName}`);
    }

    // Update task state
    const newProcessedFiles = [...processedFiles, ...filesToProcess];
    const totalFiles = processedFiles.length + pendingFiles.length;
    const progress = 30 + Math.floor((newProcessedFiles.length / totalFiles) * 60); // 30-90%

    await prisma.syncTask.update({
      where: { id: task.id },
      data: {
        pendingFiles: remainingFiles,
        processedFiles: newProcessedFiles,
        progress,
        message: `提交文件 ${newProcessedFiles.length}/${totalFiles}...`,
      },
    });

    console.log(`[SyncTask] ${task.id} - Progress: ${newProcessedFiles.length}/${totalFiles} files`);

    return { hasMore: remainingFiles.length > 0, taskId: task.id };

  } catch (error) {
    console.error(`[SyncTask] ${task.id} error:`, error);

    const errorMessage = error instanceof Error ? error.message : String(error);
    const isCancelled = errorMessage === 'Task cancelled by user';

    await prisma.syncTask.update({
      where: { id: task.id },
      data: {
        status: isCancelled ? SyncTaskStatus.Cancelled : SyncTaskStatus.Failed,
        error: errorMessage,
        completedAt: new Date(),
      },
    });

    console.log(`[SyncTask] ${task.id} - ${isCancelled ? 'Cancelled' : 'Failed'}`);
    return { hasMore: false, taskId: task.id };
  }
}
