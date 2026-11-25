import { NextRequest, NextResponse } from 'next/server'
import { verifyBotToken } from '@/lib/botAuth'
import { listMiaomiaoAutoReviewQueue } from '@/lib/services/batchBotReviewService'

export async function GET(request: NextRequest) {
  try {
    if (!await verifyBotToken()) {
      return NextResponse.json({ success: false, message: '未授权' }, { status: 401 })
    }
    const limit = Number(request.nextUrl.searchParams.get('limit') ?? 12)
    if (!Number.isInteger(limit) || limit < 1 || limit > 12) {
      return NextResponse.json({ success: false, message: '每组复审须包含 1 至 12 个词条' }, { status: 400 })
    }
    return NextResponse.json({ success: true, ...await listMiaomiaoAutoReviewQueue(limit) })
  } catch (error) {
    console.error('Automatic Miaomiao review queue error:', error)
    return NextResponse.json({ success: false, message: '无法获取待复审词条' }, { status: 500 })
  }
}
