/**
 * GET /api/sync-to-github/tasks
 * Public sync task history for the /sync page.
 */

import { listSyncTasks } from '@/lib/services/syncTaskListService'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    return listSyncTasks(request)
  } catch (error) {
    console.error('Failed to list public sync tasks:', error)
    const message = error instanceof Error ? error.message : '获取同步任务列表失败'

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    )
  }
}
