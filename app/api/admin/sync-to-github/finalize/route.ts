/**
 * POST /api/admin/sync-to-github/finalize
 * Finalize sync task by creating GitHub PR
 */

import { checkAdminPermission } from '@/lib/adminAuth';
import { prisma } from '@/lib/prisma';
import { createGithubSyncService } from '@/lib/services/githubSync';
import { SyncTaskStatus } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 10;

interface FinalizeRequest {
  taskId: string;
  summary: string;
}

export async function POST(request: NextRequest) {
  try {
    // Verify admin permission
    const authResult = await checkAdminPermission();
    if (!authResult.authorized) {
      return authResult.response;
    }

    const body: FinalizeRequest = await request.json();
    const { taskId, summary } = body;

    console.log(`[Finalize] Creating PR for task ${taskId}`);

    // Check if task exists
    const task = await prisma.syncTask.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        status: true,
        githubBranch: true,
        totalItems: true,
      },
    });

    if (!task) {
      return NextResponse.json(
        { success: false, error: '任务不存在' },
        { status: 404 }
      );
    }

    if (!task.githubBranch) {
      return NextResponse.json(
        { success: false, error: '任务尚未创建 GitHub 分支' },
        { status: 400 }
      );
    }

    if (task.status === SyncTaskStatus.Cancelled) {
      return NextResponse.json(
        { success: false, error: '任务已取消' },
        { status: 400 }
      );
    }

    // Create PR
    const githubService = createGithubSyncService();

    const pr = await githubService.createPullRequest(
      task.githubBranch,
      `[自动同步] 词库更新 - ${new Date().toLocaleDateString('zh-CN')}`,
      summary
    );

    console.log(`[Finalize] PR created: ${pr.html_url}`);

    // Mark task as completed
    await prisma.syncTask.update({
      where: { id: taskId },
      data: {
        status: SyncTaskStatus.Completed,
        progress: 100,
        message: '同步完成',
        completedAt: new Date(),
        githubPrUrl: pr.html_url,
        githubPrNumber: pr.number,
        processedItems: task.totalItems,
      },
    });

    console.log(`[Finalize] Task ${taskId} completed`);

    return NextResponse.json({
      success: true,
      prUrl: pr.html_url,
      prNumber: pr.number,
    });
  } catch (error) {
    console.error('[Finalize] Error:', error);

    // Mark task as failed
    const { taskId } = await request.json();
    if (taskId) {
      await prisma.syncTask.update({
        where: { id: taskId },
        data: {
          status: SyncTaskStatus.Failed,
          error: error instanceof Error ? error.message : '创建 PR 失败',
          completedAt: new Date(),
        },
      });
    }

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '创建 PR 失败',
      },
      { status: 500 }
    );
  }
}
