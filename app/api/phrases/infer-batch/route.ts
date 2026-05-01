import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { encodePhrase } from '@/lib/services/keytaoEncoder'
import type { InferResponse } from '../infer/route'

const MAX_WORDS = 200

// POST /api/phrases/infer-batch
// Body: { words: string[] }
// Single DB query for all words + all candidate codes combined — O(1) round-trips regardless of batch size
export async function POST(request: NextRequest) {
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
    const encodings = await Promise.all(validWords.map(w => encodePhrase(w)))

    // Collect all candidate codes (progressive codes + alt codes) across all words — dedup
    const allCodes = [...new Set(encodings.flatMap(e => [...e.codes, ...e.altCodes]))]

    // Single DB query: check existence for all words AND all code slots at once
    const matches = await prisma.phrase.findMany({
      where: {
        OR: [
          { word: { in: validWords } },
          { code: { in: allCodes } },
        ],
      },
      select: { word: true, code: true, weight: true, type: true },
      orderBy: { weight: 'asc' },
    })

    const occupiedCodes = new Set(matches.map(m => m.code))

    // word → existing entries
    const wordMap = new Map<string, Array<{ code: string; weight: number; type: string }>>()
    for (const m of matches) {
      const list = wordMap.get(m.word) ?? []
      list.push({ code: m.code, weight: m.weight, type: m.type ?? '' })
      wordMap.set(m.word, list)
    }

    const results: InferResponse[] = encodings.map((encoding, i) => {
      const word = validWords[i]
      const { codes, altCodes, type } = encoding

      let suggestion: string | null = null
      let suggestionIndex = 0

      for (let j = 0; j < codes.length; j++) {
        if (!occupiedCodes.has(codes[j])) {
          suggestion = codes[j]
          suggestionIndex = j
          break
        }
      }
      if (suggestion === null) {
        for (const alt of altCodes) {
          if (!occupiedCodes.has(alt)) {
            suggestion = alt
            suggestionIndex = -1
            break
          }
        }
      }

      return {
        word,
        type,
        codes,
        altCodes,
        suggestion,
        suggestionIndex,
        isBaseConflict: codes.length > 0 && occupiedCodes.has(codes[0]),
        wordExists: wordMap.get(word) ?? [],
      }
    })

    return NextResponse.json({ results })
  } catch (error) {
    console.error('[infer-batch]', error)
    return NextResponse.json({ error: '批量推断失败' }, { status: 500 })
  }
}
