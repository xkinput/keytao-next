import { NextRequest, NextResponse } from 'next/server'
import { inferPhrase } from '@/lib/services/phraseInference'

export type { InferResponse } from '@/lib/services/phraseInference'

// GET /api/phrases/infer?word=xxx
// Single-query high-performance endpoint: encode + check code availability + check word duplication
export async function GET(request: NextRequest) {
  const word = request.nextUrl.searchParams.get('word')?.trim()
  const requestedCode = request.nextUrl.searchParams.get('code')?.trim()
  if (!word) return NextResponse.json({ error: '缺少参数 word' }, { status: 400 })
  if (word.length > 100) return NextResponse.json({ error: 'word 最多 100 个字符' }, { status: 400 })
  if (requestedCode && requestedCode.length > 20) return NextResponse.json({ error: 'code 最多 20 个字符' }, { status: 400 })

  try {
    return NextResponse.json(await inferPhrase(word, requestedCode))
  } catch (error) {
    console.error('[infer]', error)
    return NextResponse.json({ error: '推断失败' }, { status: 500 })
  }
}
