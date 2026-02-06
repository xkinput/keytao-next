import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { checkBatchConflictsWithWeight } from '@/lib/services/batchConflictService'

interface PRItemInput {
  id: string
  action: 'Create' | 'Change' | 'Delete'
  word: string
  oldWord?: string
  code: string
  weight?: number
  type?: string
}

export async function POST(request: NextRequest) {
  try {
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

    // Use unified batch conflict detection service
    const results = await checkBatchConflictsWithWeight(items)

    return NextResponse.json({ results })
  } catch (error) {
    console.error('Batch conflict check error:', error)
    return NextResponse.json(
      { error: 'Failed to check conflicts' },
      { status: 500 }
    )
  }
}
