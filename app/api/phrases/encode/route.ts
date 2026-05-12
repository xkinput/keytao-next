import { NextRequest, NextResponse } from 'next/server'
import { analyzeRequestedCode, encodePhrase } from '@/lib/services/keytaoEncoder'

// GET /api/phrases/encode?word=xxx - Encode a word using keytao rules (public access)
export async function GET(request: NextRequest) {
  const word = request.nextUrl.searchParams.get('word')?.trim()
  const requestedCode = request.nextUrl.searchParams.get('code')?.trim()
  if (!word) return NextResponse.json({ error: '缺少参数 word' }, { status: 400 })
  if (word.length > 20) return NextResponse.json({ error: 'word 最多 20 个字符' }, { status: 400 })

  try {
    const result = await encodePhrase(word)
    return NextResponse.json(requestedCode ? { ...result, requestedCodeAnalysis: analyzeRequestedCode(result, requestedCode) } : result)
  } catch (error) {
    console.error('Encode error:', error)
    return NextResponse.json({ error: '编码失败' }, { status: 500 })
  }
}
