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

function chooseSuggestion(codes: string[], altCodes: string[], occupiedCodes: Set<string>) {
  for (let i = 0; i < codes.length; i++) {
    if (!occupiedCodes.has(codes[i])) {
      return { suggestion: codes[i], suggestionIndex: i }
    }
  }

  for (const alt of altCodes) {
    if (!occupiedCodes.has(alt)) {
      return { suggestion: alt, suggestionIndex: -1 }
    }
  }

  return { suggestion: null, suggestionIndex: 0 }
}

export async function inferPhrase(word: string, requestedCode?: string): Promise<InferResponse> {
  const encoding = await encodePhrase(word)
  const { codes, altCodes, type } = encoding
  const allCodes = [...new Set([...codes, ...altCodes])]

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

  const occupiedCodes = new Set(matches.map(m => m.code))
  const wordExists = matches
    .filter(m => m.word === word)
    .map(m => ({ code: m.code, weight: m.weight, type: m.type ?? '' }))

  const { suggestion, suggestionIndex } = chooseSuggestion(codes, altCodes, occupiedCodes)

  return {
    word,
    type,
    codes,
    altCodes,
    flyKeyVariants: encoding.flyKeyVariants,
    suggestion,
    suggestionIndex,
    isBaseConflict: codes.length > 0 && occupiedCodes.has(codes[0]),
    wordExists,
    ...(requestedCode ? { requestedCodeAnalysis: analyzeRequestedCode(encoding, requestedCode) } : {}),
  }
}

export async function inferPhrases(words: string[]): Promise<InferResponse[]> {
  const encodings = await Promise.all(words.map(w => encodePhrase(w)))
  const allCodes = [...new Set(encodings.flatMap(e => [...e.codes, ...e.altCodes]))]

  const matches = await prisma.phrase.findMany({
    where: {
      OR: [
        { word: { in: words } },
        { code: { in: allCodes } },
      ],
    },
    select: { word: true, code: true, weight: true, type: true },
    orderBy: { weight: 'asc' },
  })

  const occupiedCodes = new Set(matches.map(m => m.code))
  const wordMap = new Map<string, Array<{ code: string; weight: number; type: string }>>()
  for (const m of matches) {
    const list = wordMap.get(m.word) ?? []
    list.push({ code: m.code, weight: m.weight, type: m.type ?? '' })
    wordMap.set(m.word, list)
  }

  return encodings.map((encoding, i) => {
    const word = words[i]
    const { codes, altCodes, type, flyKeyVariants } = encoding
    const { suggestion, suggestionIndex } = chooseSuggestion(codes, altCodes, occupiedCodes)

    return {
      word,
      type,
      codes,
      altCodes,
      flyKeyVariants,
      suggestion,
      suggestionIndex,
      isBaseConflict: codes.length > 0 && occupiedCodes.has(codes[0]),
      wordExists: wordMap.get(word) ?? [],
    }
  })
}
