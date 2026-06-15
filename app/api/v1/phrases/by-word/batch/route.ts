import { NextRequest, NextResponse } from 'next/server'

import { verifyApiKey } from '@/lib/apiKeyAuth'
import { prisma } from '@/lib/prisma'
import type {
  BotBatchLookupByWordRequest,
  BotBatchLookupByWordResponse,
  BotLookupPhrase,
} from '@/lib/types/bot'

const MAX_BATCH_SIZE = 100
const MAX_WORD_LENGTH = 20

export async function POST(request: NextRequest) {
  try {
    const auth = await verifyApiKey()
    if (!auth.success) return auth.response

    const body: BotBatchLookupByWordRequest = await request.json()
    const rawWords = Array.isArray(body.words) ? body.words : []
    if (rawWords.some((word) => typeof word !== 'string')) {
      return NextResponse.json<BotBatchLookupByWordResponse>(
        { success: false, count: 0, results: [], message: '词条必须是字符串' },
        { status: 400 }
      )
    }

    const words = rawWords
      .map((word) => word.trim())
      .filter((word) => word.length > 0)

    if (words.length === 0) {
      return NextResponse.json<BotBatchLookupByWordResponse>(
        { success: false, count: 0, results: [], message: '缺少要查询的词' },
        { status: 400 }
      )
    }

    if (words.length > MAX_BATCH_SIZE) {
      return NextResponse.json<BotBatchLookupByWordResponse>(
        { success: false, count: 0, results: [], message: `一次最多查询 ${MAX_BATCH_SIZE} 个词` },
        { status: 400 }
      )
    }

    if (words.some((word) => word.length > MAX_WORD_LENGTH)) {
      return NextResponse.json<BotBatchLookupByWordResponse>(
        { success: false, count: 0, results: [], message: '词条过长' },
        { status: 400 }
      )
    }

    const uniqueWords = Array.from(new Set(words))
    const phrases = await prisma.phrase.findMany({
      where: { word: { in: uniqueWords }, status: 'Finish' },
      select: { word: true, code: true, weight: true, type: true, remark: true },
      orderBy: [{ word: 'asc' }, { code: 'asc' }, { weight: 'asc' }],
    })

    const phraseMap = new Map<string, BotLookupPhrase[]>()
    for (const phrase of phrases) {
      const items = phraseMap.get(phrase.word) || []
      items.push({
        word: phrase.word,
        code: phrase.code,
        weight: phrase.weight,
        type: phrase.type,
        remark: phrase.remark,
      })
      phraseMap.set(phrase.word, items)
    }

    const results = words.map((word) => ({
      word,
      phrases: [...(phraseMap.get(word) || [])].sort((left, right) => {
        const codeLengthDiff = left.code.length - right.code.length
        if (codeLengthDiff !== 0) return codeLengthDiff
        if (left.code !== right.code) return left.code.localeCompare(right.code)
        return left.weight - right.weight
      }),
    }))

    return NextResponse.json<BotBatchLookupByWordResponse>({
      success: true,
      count: results.length,
      results,
    })
  } catch (error) {
    console.error('[API v1] Batch lookup by word error:', error)

    return NextResponse.json<BotBatchLookupByWordResponse>(
      { success: false, count: 0, results: [], message: '查询失败' },
      { status: 500 }
    )
  }
}
