import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { CODE_PATTERN } from '@/lib/constants/codeValidation'
import { isValidPhraseType } from '@/lib/constants/phraseTypes'
import { reviewPreSubmitBatch } from '@/lib/services/preSubmitReviewService'
import type { PreSubmitReviewItem, PreSubmitReviewResponse } from '@/lib/types/preSubmitReview'
import { checkRateLimit } from '@/lib/rateLimit'
import { createHash } from 'node:crypto'

export const runtime = 'nodejs'
export const maxDuration = 300

const ACTIONS = new Set(['Create', 'Change', 'Delete'])
const inFlightReviews = new Map<string, Promise<PreSubmitReviewResponse>>()

function validateItems(value: unknown): value is PreSubmitReviewItem[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 200) return false
  const ids = new Set<string>()

  return value.every(rawItem => {
    if (!rawItem || typeof rawItem !== 'object') return false
    const item = rawItem as Partial<PreSubmitReviewItem>
    if (typeof item.id !== 'string' || ids.has(item.id)) return false
    ids.add(item.id)
    return (
      item.id.length > 0 && item.id.length <= 128 &&
      typeof item.action === 'string' && ACTIONS.has(item.action) &&
      typeof item.word === 'string' && item.word.trim().length > 0 && item.word.trim().length <= 100 &&
      typeof item.code === 'string' && item.code.trim().length > 0 && item.code.trim().length <= 20 &&
      CODE_PATTERN.test(item.code.trim()) &&
      (item.oldWord === undefined || (typeof item.oldWord === 'string' && item.oldWord.length <= 100)) &&
      (item.type === undefined || isValidPhraseType(item.type)) &&
      (item.weight === undefined || (Number.isInteger(item.weight) && Number(item.weight) >= 0)) &&
      (item.remark === undefined || (typeof item.remark === 'string' && item.remark.length <= 2000))
    )
  })
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const body = await request.json().catch(() => null) as { items?: unknown } | null
    if (!validateItems(body?.items)) {
      return NextResponse.json({ error: '词条审查参数格式错误' }, { status: 400 })
    }

    const requestHash = createHash('sha256').update(JSON.stringify(body.items)).digest('hex')
    const inFlightKey = `${session.id}:${requestHash}`
    let task = inFlightReviews.get(inFlightKey)
    if (!task) {
      const { allowed, retryAfterMs } = checkRateLimit(`pre-submit-review:${session.id}`)
      if (!allowed) {
        return NextResponse.json(
          { error: '审词请求过于频繁', retryAfterMs },
          {
            status: 429,
            headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) },
          },
        )
      }

      task = reviewPreSubmitBatch(body.items)
      inFlightReviews.set(inFlightKey, task)
      void task.finally(() => {
        if (inFlightReviews.get(inFlightKey) === task) {
          inFlightReviews.delete(inFlightKey)
        }
      }).catch(() => undefined)
    }

    const result = await task
    return NextResponse.json(result)
  } catch (error) {
    console.error('Pre-submit Miaomiao review error:', error)
    return NextResponse.json({ error: '提交前审词失败' }, { status: 500 })
  }
}
