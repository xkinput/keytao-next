import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { conflictDetector } from '@/lib/services/conflictDetector'
import { PullRequestType } from '@prisma/client'

// POST /api/pull-requests/check-conflicts - Check for conflicts before creating PR
export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const body = await request.json()
    const { action, word, oldWord, code, phraseId, weight } = body

    if (!action || !word || !code) {
      return NextResponse.json(
        { error: '缺少必要参数' },
        { status: 400 }
      )
    }

    if (action === 'Change' && !oldWord) {
      return NextResponse.json(
        { error: '修改操作需要指定旧词' },
        { status: 400 }
      )
    }

    const conflict = await conflictDetector.checkConflict({
      action: action as PullRequestType,
      word,
      oldWord,
      code,
      phraseId,
      weight
    })

    return NextResponse.json({ conflict })
  } catch (error) {
    console.error('Check conflicts error:', error)
    return NextResponse.json(
      { error: '冲突检测失败' },
      { status: 500 }
    )
  }
}
