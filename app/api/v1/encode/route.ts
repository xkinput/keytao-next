import { NextRequest, NextResponse } from 'next/server'
import { verifyApiKey } from '@/lib/apiKeyAuth'
import { inferPhrase } from '@/lib/services/phraseInference'

// GET /api/v1/encode?word=xxx
// API-key endpoint used by integrations such as keytao-bot. Returns the same
// inferred code shape as /api/phrases/infer?word=xxx.
export async function GET(request: NextRequest) {
  const auth = await verifyApiKey()
  if (!auth.success) return auth.response

  const word = request.nextUrl.searchParams.get('word')?.trim()
  const requestedCode = request.nextUrl.searchParams.get('code')?.trim()
  if (!word) {
    return NextResponse.json({ error: '缺少参数 word' }, { status: 400 })
  }

  if (word.length > 20) {
    return NextResponse.json({ error: 'word 最多 20 个字符' }, { status: 400 })
  }

  try {
    return NextResponse.json(await inferPhrase(word, requestedCode))
  } catch (error) {
    console.error('[v1/encode]', error)
    return NextResponse.json({ error: '推断失败' }, { status: 500 })
  }
}
