import { NextRequest, NextResponse } from 'next/server'
import { verifyApiKey } from '@/lib/apiKeyAuth'
import { encodePhrase } from '@/lib/services/keytaoEncoder'

export async function GET(request: NextRequest) {
  const auth = await verifyApiKey()
  if (!auth.success) return auth.response

  const word = request.nextUrl.searchParams.get('word')
  if (!word || word.trim() === '') {
    return NextResponse.json({ error: '缺少参数 word' }, { status: 400 })
  }

  if (word.length > 20) {
    return NextResponse.json({ error: 'word 最多 20 个字符' }, { status: 400 })
  }

  const result = await encodePhrase(word.trim())
  return NextResponse.json(result)
}
