import { convert } from 'pinyin-pro'

export type PronunciationDataset = 'large_pinyin' | 'zdic_cibs' | 'zdic_cybs' | 'cedict'

export interface PronunciationImportRow {
  word: string
  reading: string
  source: PronunciationDataset
}

export interface FrequencyImportRow {
  word: string
  frequency: number
}

export interface ReferenceDataFixtureInput {
  largePinyin: string
  zdicCibs: string
  zdicCybs: string
  cedict: string
  jieba: string
}

export interface JoinedReferenceData {
  word: string
  frequency: number | null
  readings: Array<{
    reading: string
    sources: PronunciationDataset[]
  }>
}

function normalizeReading(reading: string): string {
  return reading.trim().replace(/\s+/g, ' ').toLowerCase()
}

export function toneNumbersToSymbols(reading: string): string {
  const cedictNotation = normalizeReading(reading)
    .replace(/u\s*:\s*([0-5])/gi, 'ü$1')
    .split(' ')
    .map(syllable => syllable.replace(/5$/, ''))
    .join(' ')
  return normalizeReading(convert(cedictNotation, { format: 'numToSymbol' }))
}

export function parseColonPronunciations(
  content: string,
  source: Exclude<PronunciationDataset, 'cedict'>,
): PronunciationImportRow[] {
  const rows: PronunciationImportRow[] = []
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf(':')
    if (separator <= 0) continue
    const word = line.slice(0, separator).trim()
    const reading = normalizeReading(line.slice(separator + 1))
    if (word && reading) rows.push({ word, reading, source })
  }
  return rows
}

export function parseCedictPronunciations(content: string): PronunciationImportRow[] {
  const rows: PronunciationImportRow[] = []
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^(\S+)\s+(\S+)\s+\[([^\]]+)]\s+\//)
    if (!match) continue
    const [, traditional, simplified, numberedReading] = match
    const reading = toneNumbersToSymbols(numberedReading)
    for (const word of new Set([traditional, simplified])) {
      rows.push({ word, reading, source: 'cedict' })
    }
  }
  return rows
}

export function parseJiebaFrequencies(content: string): FrequencyImportRow[] {
  const frequencyByWord = new Map<string, number>()
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^(\S+)\s+(\d+)(?:\s+\S+)?$/)
    if (!match) continue
    const frequency = Number(match[2])
    frequencyByWord.set(match[1], Math.max(frequencyByWord.get(match[1]) ?? 0, frequency))
  }
  return [...frequencyByWord].map(([word, frequency]) => ({ word, frequency }))
}

export function parseReferenceDataFixture(input: ReferenceDataFixtureInput): {
  pronunciations: PronunciationImportRow[]
  frequencies: FrequencyImportRow[]
  byWord: Map<string, JoinedReferenceData>
} {
  const pronunciations = [
    ...parseColonPronunciations(input.largePinyin, 'large_pinyin'),
    ...parseColonPronunciations(input.zdicCibs, 'zdic_cibs'),
    ...parseColonPronunciations(input.zdicCybs, 'zdic_cybs'),
    ...parseCedictPronunciations(input.cedict),
  ]
  const frequencies = parseJiebaFrequencies(input.jieba)
  const byWord = new Map<string, JoinedReferenceData>()

  for (const row of pronunciations) {
    const entry = byWord.get(row.word) ?? { word: row.word, frequency: null, readings: [] }
    const existing = entry.readings.find(reading => reading.reading === row.reading)
    if (existing) {
      if (!existing.sources.includes(row.source)) existing.sources.push(row.source)
    } else {
      entry.readings.push({ reading: row.reading, sources: [row.source] })
    }
    byWord.set(row.word, entry)
  }

  for (const row of frequencies) {
    const entry = byWord.get(row.word) ?? { word: row.word, frequency: null, readings: [] }
    entry.frequency = row.frequency
    byWord.set(row.word, entry)
  }

  return { pronunciations, frequencies, byWord }
}
