import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { checkBatchConflictsWithWeight } from '@/lib/services/batchConflictService'
import { buildBatchSubmitWarnings } from '@/lib/services/batchSubmitWarnings'
import { buildSkippedCandidateSlotWarnings } from '@/lib/services/batchSkippedCodeWarnings'
import { buildPriorityOrderWarnings } from '@/lib/services/batchPriorityOrderWarnings'
import { PhraseType } from '@/lib/constants/phraseTypes'

interface PRItemInput {
  id: string
  action: 'Create' | 'Change' | 'Delete'
  word: string
  oldWord?: string
  code: string
  weight?: number
  type?: PhraseType
}

export async function POST(request: NextRequest) {
  try {
    const maxItems = 500
    const maxWordLength = 100
    const maxCodeLength = 20

    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const body = await request.json()
    const { items } = body as { items: PRItemInput[] }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: 'Invalid items array' },
        { status: 400 }
      )
    }

    if (items.length > maxItems) {
      return NextResponse.json({ error: `最多 ${maxItems} 个条目` }, { status: 400 })
    }

    for (const item of items) {
      if (
        typeof item.word !== 'string' ||
        typeof item.code !== 'string' ||
        item.word.trim().length === 0 ||
        item.code.trim().length === 0 ||
        item.word.trim().length > maxWordLength ||
        item.code.trim().length > maxCodeLength
      ) {
        return NextResponse.json({ error: '词条或编码格式错误' }, { status: 400 })
      }
    }

    // Use unified batch conflict detection service
    const [results, skippedSlotWarnings, priorityWarnings] = await Promise.all([
      checkBatchConflictsWithWeight(items),
      buildSkippedCandidateSlotWarnings(items),
      buildPriorityOrderWarnings(items),
    ])
    const warnings = [
      ...buildBatchSubmitWarnings(items, results),
      ...skippedSlotWarnings,
      ...priorityWarnings,
    ]

    return NextResponse.json({ results, warnings })
  } catch (error) {
    console.error('Batch conflict check error:', error)
    return NextResponse.json(
      { error: 'Failed to check conflicts' },
      { status: 500 }
    )
  }
}
