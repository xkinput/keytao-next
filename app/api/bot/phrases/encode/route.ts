import { NextRequest, NextResponse } from 'next/server'

import { verifyBotToken } from '@/lib/botAuth'
import { analyzeRequestedCode, encodePhrase } from '@/lib/services/keytaoEncoder'

// Bot-only encoding route. Semantic pronunciation is accepted only from the
// authenticated bot service, then independently validated by the encoder.
export async function GET(request: NextRequest) {
  if (!await verifyBotToken()) {
    return NextResponse.json({ error: '未授权' }, { status: 401 })
  }

  const word = request.nextUrl.searchParams.get('word')?.trim()
  const requestedCode = request.nextUrl.searchParams.get('code')?.trim()
  const semanticPinyin = request.nextUrl.searchParams.get('semantic_pinyin')?.trim() || ''
  const semanticMeaning = request.nextUrl.searchParams.get('semantic_meaning')?.trim() || ''

  if (!word) return NextResponse.json({ error: '缺少参数 word' }, { status: 400 })
  if (word.length > 100) return NextResponse.json({ error: 'word 最多 100 个字符' }, { status: 400 })
  if (requestedCode && requestedCode.length > 20) {
    return NextResponse.json({ error: 'code 最多 20 个字符' }, { status: 400 })
  }
  if (semanticPinyin.length > 240 || semanticMeaning.length > 500) {
    return NextResponse.json({ error: '语义读音参数过长' }, { status: 400 })
  }
  if (Boolean(semanticPinyin) !== Boolean(semanticMeaning)) {
    return NextResponse.json({ error: 'semantic_pinyin 与 semantic_meaning 必须同时提供' }, { status: 400 })
  }

  try {
    const result = await encodePhrase(word, {
      ...(semanticPinyin ? {
        semanticPronunciation: {
          pinyins: semanticPinyin.split(/\s+/).filter(Boolean),
          meaning: semanticMeaning,
        },
      } : {}),
    })
    return NextResponse.json(
      requestedCode
        ? { ...result, requestedCodeAnalysis: analyzeRequestedCode(result, requestedCode) }
        : result,
    )
  } catch (error) {
    console.error('[bot/phrases/encode]', error)
    return NextResponse.json({ error: '编码计算失败' }, { status: 500 })
  }
}
