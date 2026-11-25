import { NextResponse, type NextRequest } from 'next/server'
import { checkAdminPermission } from '@/lib/adminAuth'
import { AuthInfrastructureError, getSession } from '@/lib/auth'
import { isValidPhraseType } from '@/lib/constants/phraseTypes'
import { BatchContentLockedError } from '@/lib/services/batchContentGuard'
import { ItemReviewError } from '@/lib/services/batchItemReview'
import { reorderBatchChain, type ChainReorderTarget } from '@/lib/services/suggestedOrderService'

const MAX_INT = 2147483647

function isPrId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_INT
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await checkAdminPermission()
    if (!admin.authorized && admin.response?.status !== 403) {
      return admin.response?.status === 401 || admin.response?.status === 503
        ? admin.response : NextResponse.json({ error: '权限不足' }, { status: 403 })
    }
    const session = admin.authorized ? admin.session : await getSession()
    if (!session) return NextResponse.json({ error: '未登录' }, { status: 401 })

    const { id: batchId } = await params
    const body = await request.json().catch(() => null)
    const { code, type, movedPrId, beforePrId, afterWord, expectedContentVersion } = body ?? {}
    let target: ChainReorderTarget | undefined
    if (afterWord === undefined && (beforePrId === null || isPrId(beforePrId))) target = { beforePrId }
    if (beforePrId === undefined && (afterWord === null || (typeof afterWord === 'string' && afterWord.length > 0))) {
      target = { afterWord }
    }
    if (typeof code !== 'string' || !code.trim() || typeof type !== 'string' || !isValidPhraseType(type) ||
      !isPrId(movedPrId) || !target || !Number.isInteger(expectedContentVersion) ||
      expectedContentVersion < 0 || expectedContentVersion >= MAX_INT) {
      return NextResponse.json({ error: '编码链、排序目标或批次版本无效' }, { status: 400 })
    }

    return NextResponse.json(await reorderBatchChain({
      batchId, code, type, movedPrId, target, expectedContentVersion, userId: session.id, isAdmin: admin.authorized,
    }))
  } catch (error) {
    if (error instanceof BatchContentLockedError || error instanceof ItemReviewError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof AuthInfrastructureError) {
      return NextResponse.json({ error: '认证服务暂不可用' }, { status: 503 })
    }
    console.error('Reordering batch chain failed:', error)
    return NextResponse.json({ error: '调整词条顺序失败' }, { status: 500 })
  }
}
