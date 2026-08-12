import { prisma } from '@/lib/prisma'
import type { PronunciationDataset } from '@/lib/reference-data/referenceDataImport'
import type {
  BatchReferenceEvidence,
  BatchReferenceReading,
} from '@/lib/types/batchAiReview'
import {
  analyzeRequestedCode,
  buildPhraseEncodingFromChars,
  encodePhonetic,
  encodeShape,
  parsePinyin,
  type CharEncoding,
} from './keytaoEncoder'

const SOURCE_LABELS: Record<PronunciationDataset, string> = {
  large_pinyin: '大型拼音词库（离线数据集）',
  zdic_cibs: '汉典（离线数据集）',
  zdic_cybs: '汉典（离线数据集）',
  cedict: 'CC-CEDICT',
}

const SOURCE_ORDER: PronunciationDataset[] = [
  'zdic_cibs',
  'zdic_cybs',
  'cedict',
  'large_pinyin',
]
const DICTIONARY_SOURCES = new Set<PronunciationDataset>(['zdic_cibs', 'zdic_cybs', 'cedict'])

interface StoredReferenceReading {
  reading: string
  sources: PronunciationDataset[]
}

export interface ReferenceWordData {
  word: string
  readings: StoredReferenceReading[]
  frequency: number | null
}

function uniqueWords(words: string[]): string[] {
  return [...new Set(words.map(word => word.trim()).filter(Boolean))]
}

function sourceRank(source: PronunciationDataset): number {
  const index = SOURCE_ORDER.indexOf(source)
  return index < 0 ? SOURCE_ORDER.length : index
}

export async function loadReferenceWordData(words: string[]): Promise<Map<string, ReferenceWordData>> {
  const requestedWords = uniqueWords(words)
  const result = new Map<string, ReferenceWordData>()
  if (requestedWords.length === 0) return result

  let pronunciations: Array<{ word: string; reading: string; source: string }>
  let frequencies: Array<{ word: string; frequency: number }>
  try {
    [pronunciations, frequencies] = await Promise.all([
      prisma.pronunciationReference.findMany({
        where: { word: { in: requestedWords } },
        select: { word: true, reading: true, source: true },
        orderBy: [{ word: 'asc' }, { reading: 'asc' }, { source: 'asc' }],
      }),
      prisma.corpusFrequency.findMany({
        where: { word: { in: requestedWords } },
        select: { word: true, frequency: true },
      }),
    ])
  } catch (error) {
    // Reference availability is not a review gate. A missing migration or
    // transient lookup failure leaves legacy review behavior unchanged.
    console.warn(
      '[referenceReviewService] Offline reference lookup unavailable',
      error instanceof Error ? error.name : 'UnknownError',
    )
    return result
  }

  for (const row of pronunciations) {
    if (!Object.hasOwn(SOURCE_LABELS, row.source)) continue
    const source = row.source as PronunciationDataset
    const entry = result.get(row.word) ?? { word: row.word, readings: [], frequency: null }
    const reading = entry.readings.find(item => item.reading === row.reading)
    if (reading) {
      if (!reading.sources.includes(source)) reading.sources.push(source)
    } else {
      entry.readings.push({ reading: row.reading, sources: [source] })
    }
    result.set(row.word, entry)
  }

  for (const entry of result.values()) {
    for (const reading of entry.readings) {
      reading.sources.sort((a, b) => sourceRank(a) - sourceRank(b))
    }
  }

  for (const row of frequencies) {
    const entry = result.get(row.word) ?? { word: row.word, readings: [], frequency: null }
    entry.frequency = row.frequency
    result.set(row.word, entry)
  }

  return result
}

function buildCharEncoding(char: string, pinyin: string): CharEncoding {
  const { initial, final } = parsePinyin(pinyin)
  const phoneticCode = encodePhonetic(initial, final)
  const shape = encodeShape(char)
  return {
    char,
    pinyin,
    pinyins: [pinyin],
    phoneticCode,
    c1: shape?.c1 ?? null,
    c2: shape?.c2 ?? null,
    shapeCode: shape?.code ?? null,
    fullCode: phoneticCode + (shape?.code ?? ''),
  }
}

export function isReadingConsistentWithCode(word: string, reading: string, code: string): boolean {
  const chars = Array.from(word)
  const syllables = reading.trim().split(/\s+/).filter(Boolean)
  if (chars.length === 0 || chars.length !== syllables.length || !code.trim()) return false

  const encoding = buildPhraseEncodingFromChars(
    word,
    chars.map((char, index) => buildCharEncoding(char, syllables[index])),
  )
  return analyzeRequestedCode(encoding, code).supported
}

function canonicalReading(reading: string): string {
  return reading.trim().split(/\s+/).filter(Boolean).map((syllable) => {
    const normalizedSyllable = syllable.replace(/u:/gi, 'ü').replace(/[1-5]$/, '')
    const { initial, final } = parsePinyin(normalizedSyllable)
    return `${initial}:${final}`
  }).join(' ')
}

function labelsForSources(sources: PronunciationDataset[]): string[] {
  return [...new Set(sources.map(source => SOURCE_LABELS[source]))]
}

export function hasDictionaryReference(data: ReferenceWordData): boolean {
  return data.readings.some(reading => reading.sources.some(source => DICTIONARY_SOURCES.has(source)))
}

function formatEvidenceLine(readings: BatchReferenceReading[], frequency: number | null): string {
  const readingText = readings.length > 0
    ? readings.map(reading => (
      `${reading.reading}（${reading.sources.join('、')}；${reading.codeConsistent ? '编码一致' : '编码不一致'}）`
    )).join('；')
    : '未收录'
  const frequencyText = frequency === null ? '未收录' : String(frequency)
  return `参考读音：${readingText}；语料频次：${frequencyText}。`
}

export function buildReferenceEvidence(
  data: ReferenceWordData | undefined,
  code: string,
  claimedReading?: string,
): BatchReferenceEvidence | undefined {
  if (!data) return undefined

  const readings = data.readings.map((reading): BatchReferenceReading => ({
    reading: reading.reading,
    sources: labelsForSources(reading.sources),
    codeConsistent: isReadingConsistentWithCode(data.word, reading.reading, code),
  }))
  const normalizedClaim = claimedReading?.trim() || undefined
  const claimedReadingPresent = normalizedClaim
    ? readings.some(reading => canonicalReading(reading.reading) === canonicalReading(normalizedClaim))
    : undefined
  const consistentReadings = normalizedClaim
    ? readings.filter(reading => canonicalReading(reading.reading) === canonicalReading(normalizedClaim))
    : readings
  const validation = readings.length === 0
    ? 'not_applicable'
    : consistentReadings.some(reading => reading.codeConsistent) ? 'match' : 'mismatch'

  return {
    dictionaryPresent: hasDictionaryReference(data),
    frequency: data.frequency,
    validation,
    ...(normalizedClaim ? { claimedReading: normalizedClaim, claimedReadingPresent } : {}),
    readings,
    line: formatEvidenceLine(readings, data.frequency),
  }
}
