import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { analyzeRequestedCode, encodePhrase } from '@/lib/services/keytaoEncoder'
import type { FlyKeyVariant, RequestedCodeAnalysis } from '@/lib/services/keytaoEncoder'

export interface InferResponse {
  word: string
  type: string
  codes: string[]
  altCodes: string[]
  flyKeyVariants: FlyKeyVariant[]
  /** First available code. null if all variants are occupied. */
  suggestion: string | null
  /** Which index of codes[] was chosen (0 = base code). */
  suggestionIndex: number
  /** true when the base code is already occupied */
  isBaseConflict: boolean
  /** Existing DB entries for this exact word (empty array = no duplicate) */
  wordExists: Array<{ code: string; weight: number; type: string }>
  /** Analysis for a user-provided code, when the code query parameter is present. */
  requestedCodeAnalysis?: RequestedCodeAnalysis
}

// GET /api/phrases/infer?word=xxx
// Single-query high-performance endpoint: encode + check code availability + check word duplication
export async function GET(request: NextRequest) {
  const word = request.nextUrl.searchParams.get('word')?.trim()
  const requestedCode = request.nextUrl.searchParams.get('code')?.trim()
  if (!word) return NextResponse.json({ error: '缺少参数 word' }, { status: 400 })
  if (word.length > 20) return NextResponse.json({ error: 'word 最多 20 个字符' }, { status: 400 })

  try {
    const encoding = await encodePhrase(word)
    const { codes, altCodes, type } = encoding

    // All code variants to check availability for (dedup)
    const allCodes = [...new Set([...codes, ...altCodes])]

    // Single DB query: fetch phrases matching the word OR any of the candidate codes
    const matches = await prisma.phrase.findMany({
      where: {
        OR: [
          { word: { equals: word } },
          { code: { in: allCodes } },
        ],
      },
      select: { word: true, code: true, weight: true, type: true },
      orderBy: { weight: 'asc' },
    })

    const occupiedCodes = new Set(matches.filter(m => m.word !== word || m.code !== undefined).map(m => m.code))
    const wordExistsEntries = matches
      .filter(m => m.word === word)
      .map(m => ({ code: m.code, weight: m.weight, type: m.type ?? '' }))

    // Find first available code from progressive variants
    let suggestion: string | null = null
    let suggestionIndex = 0
    for (let i = 0; i < codes.length; i++) {
      if (!occupiedCodes.has(codes[i])) {
        suggestion = codes[i]
        suggestionIndex = i
        break
      }
    }
    // Fallback: if all progressive codes occupied, try altCodes
    if (suggestion === null) {
      for (const alt of altCodes) {
        if (!occupiedCodes.has(alt)) {
          suggestion = alt
          suggestionIndex = -1 // signal: from altCodes
          break
        }
      }
    }

    const isBaseConflict = codes.length > 0 && occupiedCodes.has(codes[0])

    const resp: InferResponse = {
      word,
      type,
      codes,
      altCodes,
      flyKeyVariants: encoding.flyKeyVariants,
      suggestion,
      suggestionIndex,
      isBaseConflict,
      wordExists: wordExistsEntries,
      ...(requestedCode ? { requestedCodeAnalysis: analyzeRequestedCode(encoding, requestedCode) } : {}),
    }

    return NextResponse.json(resp)
  } catch (error) {
    console.error('[infer]', error)
    return NextResponse.json({ error: '推断失败' }, { status: 500 })
  }
}
