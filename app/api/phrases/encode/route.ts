import { NextRequest, NextResponse } from 'next/server'
import { analyzeRequestedCode, encodePhrase } from '@/lib/services/keytaoEncoder'
import { MAX_CODE_LENGTH_ANY_TYPE } from '@/lib/constants/codeValidation'

export const maxDuration = 30

// GET /api/phrases/encode?word=xxx - Encode a word using keytao rules (public access)
// Public and header-agnostic: only query params are read, so callers such as
// keytao-bot may send extra headers (X-Bot-Token) without being rejected.
export async function GET(request: NextRequest) {
  const word = request.nextUrl.searchParams.get('word')?.trim()
  const requestedCode = request.nextUrl.searchParams.get('code')?.trim()
  if (!word) return NextResponse.json({ error: '缺少参数 word' }, { status: 400 })
  if (word.length > 100) return NextResponse.json({ error: 'word 最多 100 个字符' }, { status: 400 })
  if (requestedCode && requestedCode.length > MAX_CODE_LENGTH_ANY_TYPE) {
    return NextResponse.json({ error: `code 最多 ${MAX_CODE_LENGTH_ANY_TYPE} 个字符` }, { status: 400 })
  }

  try {
    const result = await encodePhrase(word)
    return NextResponse.json(requestedCode ? { ...result, requestedCodeAnalysis: analyzeRequestedCode(result, requestedCode) } : result)
  } catch (error) {
    console.error('Encode error:', error)
    return NextResponse.json({ error: '编码失败' }, { status: 500 })
  }
}
