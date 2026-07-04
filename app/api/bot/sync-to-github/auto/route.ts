/**
 * POST /api/bot/sync-to-github/auto
 * Bot-only endpoint for scheduled GitHub dictionary sync.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyBotToken } from '@/lib/botAuth'
import {
  DEFAULT_GITHUB_AUTO_SYNC_THRESHOLD,
  runGithubAutoSync,
} from '@/lib/services/githubAutoSyncService'

export const runtime = 'nodejs'
export const maxDuration = 60

function normalizeThreshold(value: unknown): number {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_GITHUB_AUTO_SYNC_THRESHOLD
  }
  const numeric = Number(value)
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 1000) {
    return DEFAULT_GITHUB_AUTO_SYNC_THRESHOLD
  }
  return numeric
}

export async function POST(request: NextRequest) {
  try {
    if (!await verifyBotToken()) {
      return NextResponse.json({ success: false, message: '未授权' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const threshold = normalizeThreshold(body?.threshold)
    const result = await runGithubAutoSync({ threshold })

    const status = result.success ? 200 : 400
    return NextResponse.json(result, { status })
  } catch (error) {
    console.error('[Bot API] GitHub auto sync error:', error)
    return NextResponse.json(
      {
        success: false,
        triggered: false,
        pendingSyncBatches: 0,
        message: error instanceof Error ? error.message : 'GitHub 自动同步失败',
      },
      { status: 500 }
    )
  }
}
