import { NextRequest, NextResponse } from 'next/server'
import { checkAdminPermission } from '@/lib/adminAuth'
import { prisma } from '@/lib/prisma'
import { SyncTaskStatus } from '@prisma/client'

// POST /api/admin/sync-to-github/cancel/:taskId - Cancel a sync task
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const authCheck = await checkAdminPermission()
    if (!authCheck.authorized) {
      return authCheck.response
    }

    const { taskId } = await params

    // Get current task status
    const task = await prisma.syncTask.findUnique({
      where: { id: taskId },
      select: { status: true, progress: true }
    })

    if (!task) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 })
    }

    // Only allow cancelling Pending or Running tasks
    if (task.status !== SyncTaskStatus.Pending && task.status !== SyncTaskStatus.Running) {
      return NextResponse.json(
        { error: '只能取消等待中或运行中的任务' },
        { status: 400 }
      )
    }

    // For Pending tasks, mark as cancelled immediately
    if (task.status === SyncTaskStatus.Pending) {
      await prisma.syncTask.update({
        where: { id: taskId },
        data: {
          status: SyncTaskStatus.Cancelled,
          error: 'Cancelled by admin',
          completedAt: new Date()
        }
      })

      return NextResponse.json({
        success: true,
        message: '任务已取消'
      })
    }

    // For Running tasks, set status to Cancelled
    // The task will check this status and stop at the next checkpoint
    await prisma.syncTask.update({
      where: { id: taskId },
      data: {
        status: SyncTaskStatus.Cancelled,
        message: '正在取消...'
      }
    })

    // Determine if GitHub cleanup may be needed based on progress
    const needsCleanup = task.progress >= 70 // Files may have been committed

    return NextResponse.json({
      success: true,
      message: '取消请求已发送',
      needsCleanup,
      cleanupNote: needsCleanup
        ? '任务可能已在 GitHub 创建分支或提交文件，可能需要手动清理'
        : null
    })
  } catch (error) {
    console.error('Cancel sync task error:', error)
    return NextResponse.json(
      { error: '取消任务失败' },
      { status: 500 }
    )
  }
}
