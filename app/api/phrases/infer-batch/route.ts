import { NextRequest, NextResponse } from 'next/server'
import { inferPhrases } from '@/lib/services/phraseInference'
import { checkRateLimit } from '@/lib/rateLimit'

const MAX_WORDS = 200

function clientKey(request: NextRequest) {
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwardedFor || request.headers.get('x-real-ip')?.trim() || 'unknown'
}

// POST /api/phrases/infer-batch
// Body: { words: string[] }
// Single DB query for all words + all candidate codes combined — O(1) round-trips regardless of batch size
export async function POST(request: NextRequest) {
  const { allowed, retryAfterMs } = checkRateLimit(`phrases:infer-batch:${clientKey(request)}`)
  if (!allowed) {
    return NextResponse.json(
      { error: '请求过于频繁', retryAfterMs },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) },
      }
    )
  }

  let body: { words: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 })
  }

  const words = body.words
  if (!Array.isArray(words) || words.length === 0) {
    return NextResponse.json({ error: '缺少参数 words' }, { status: 400 })
  }
  if (words.length > MAX_WORDS) {
    return NextResponse.json({ error: `最多 ${MAX_WORDS} 个词条` }, { status: 400 })
  }

  const validWords = words
    .filter((w): w is string => typeof w === 'string' && w.trim().length > 0 && w.trim().length <= 20)
    .map(w => w.trim())

  if (validWords.length === 0) {
    return NextResponse.json({ error: '没有有效词条' }, { status: 400 })
  }

  try {
    return NextResponse.json({ results: await inferPhrases(validWords) })
  } catch (error) {
    console.error('[infer-batch]', error)
    return NextResponse.json({ error: '批量推断失败' }, { status: 500 })
  }
}
