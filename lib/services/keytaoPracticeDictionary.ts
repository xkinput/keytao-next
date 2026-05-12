export interface PracticeEntry {
  text: string
  code: string
  weight?: number
  source: string
}

export interface PracticeItem {
  text: string
  codes: string[]
}

export interface PracticeDictionary {
  entries: PracticeEntry[]
  entriesByText: Map<string, PracticeEntry[]>
  entriesByCode: Map<string, PracticeEntry[]>
  prefixIndex: Map<string, PracticeEntry[]>
  textSet: Set<string>
  maxTextLength: number
  sourceFiles: string[]
  sourceName: string
  version?: string
}

interface BuildDictionaryOptions {
  sourceFiles?: string[]
  sourceName?: string
  version?: string
}

const MAX_TEXT_MATCH_LENGTH = 8

function normalizeCode(code: string): string {
  return code.trim().toLowerCase()
}

function compareEntries(a: PracticeEntry, b: PracticeEntry): number {
  if (a.code !== b.code) return a.code.localeCompare(b.code)
  return (a.weight ?? 0) - (b.weight ?? 0)
}

function compareCandidates(a: PracticeEntry, b: PracticeEntry): number {
  if (a.code.length !== b.code.length) return a.code.length - b.code.length
  return compareEntries(a, b)
}

export function parseRimeDictContent(content: string, source = 'inline.dict.yaml'): PracticeEntry[] {
  const entries: PracticeEntry[] = []
  const lines = content.split(/\r?\n/)
  let inDataSection = false

  for (const rawLine of lines) {
    const trimmed = rawLine.trim()
    if (trimmed === '...') {
      inDataSection = true
      continue
    }

    if (!inDataSection || !trimmed || trimmed.startsWith('#')) continue

    const parts = rawLine.includes('\t')
      ? rawLine.split('\t').map((part) => part.trim())
      : trimmed.split(/\s+/).map((part) => part.trim())

    if (parts.length < 2) continue

    const text = parts[0]
    const code = normalizeCode(parts[1])
    if (!text || !code) continue

    const weightValue = parts[2] ? Number.parseInt(parts[2], 10) : undefined
    entries.push({
      text,
      code,
      weight: Number.isFinite(weightValue) ? weightValue : undefined,
      source,
    })
  }

  return entries
}

export function buildPracticeDictionary(
  rawEntries: PracticeEntry[],
  options: BuildDictionaryOptions = {}
): PracticeDictionary {
  const uniqueEntries = new Map<string, PracticeEntry>()

  for (const entry of rawEntries) {
    const normalizedEntry = { ...entry, code: normalizeCode(entry.code) }
    const key = `${normalizedEntry.text}\t${normalizedEntry.code}`
    const existing = uniqueEntries.get(key)
    if (!existing || (normalizedEntry.weight ?? 0) < (existing.weight ?? 0)) {
      uniqueEntries.set(key, normalizedEntry)
    }
  }

  const entries = Array.from(uniqueEntries.values()).sort(compareEntries)
  const entriesByText = new Map<string, PracticeEntry[]>()
  const entriesByCode = new Map<string, PracticeEntry[]>()
  const prefixIndex = new Map<string, PracticeEntry[]>()
  const textSet = new Set<string>()
  let maxTextLength = 0

  for (const entry of entries) {
    textSet.add(entry.text)
    maxTextLength = Math.max(maxTextLength, entry.text.length)

    const byText = entriesByText.get(entry.text) ?? []
    byText.push(entry)
    entriesByText.set(entry.text, byText)

    const byCode = entriesByCode.get(entry.code) ?? []
    byCode.push(entry)
    entriesByCode.set(entry.code, byCode)

    const prefix = entry.code.slice(0, Math.min(2, entry.code.length))
    const byPrefix = prefixIndex.get(prefix) ?? []
    byPrefix.push(entry)
    prefixIndex.set(prefix, byPrefix)
  }

  for (const entriesForText of entriesByText.values()) entriesForText.sort(compareEntries)
  for (const entriesForCode of entriesByCode.values()) entriesForCode.sort(compareEntries)
  for (const entriesForPrefix of prefixIndex.values()) entriesForPrefix.sort(compareCandidates)

  return {
    entries,
    entriesByText,
    entriesByCode,
    prefixIndex,
    textSet,
    maxTextLength,
    sourceFiles: options.sourceFiles ?? [],
    sourceName: options.sourceName ?? 'KeyTao Rime dictionary',
    version: options.version,
  }
}

export function getCodesForText(
  dictionary: PracticeDictionary,
  text: string,
  limit = 8
): string[] {
  const entries = dictionary.entriesByText.get(text) ?? []
  const codes: string[] = []
  const seenCodes = new Set<string>()

  for (const entry of entries) {
    if (seenCodes.has(entry.code)) continue
    seenCodes.add(entry.code)
    codes.push(entry.code)
    if (codes.length >= limit) break
  }

  return codes
}

export function getCandidatesForCode(
  dictionary: PracticeDictionary,
  code: string,
  limit = 12
): PracticeEntry[] {
  const normalizedCode = normalizeCode(code)
  if (!normalizedCode) return []

  const exactEntries = dictionary.entriesByCode.get(normalizedCode) ?? []
  const seen = new Set(exactEntries.map((entry) => `${entry.text}\t${entry.code}`))
  const prefix = normalizedCode.slice(0, Math.min(2, normalizedCode.length))
  const bucket = dictionary.prefixIndex.get(prefix) ?? dictionary.entries
  const prefixEntries = bucket
    .filter((entry) => entry.code.startsWith(normalizedCode) && !seen.has(`${entry.text}\t${entry.code}`))
    .sort(compareCandidates)

  return [...exactEntries, ...prefixEntries].slice(0, limit)
}

export function hasTextCandidateForCode(
  dictionary: PracticeDictionary,
  text: string,
  code: string,
  match: 'exact' | 'prefix' = 'exact'
): boolean {
  const normalizedCode = normalizeCode(code)
  if (!normalizedCode) return false

  const entries = dictionary.entriesByText.get(text) ?? []
  return entries.some((entry) => (
    match === 'exact'
      ? entry.code === normalizedCode
      : entry.code.startsWith(normalizedCode)
  ))
}

export function createPracticeItemsFromText(
  content: string,
  dictionary: PracticeDictionary,
  limit = 30
): PracticeItem[] {
  const items: PracticeItem[] = []
  let cursor = 0

  while (cursor < content.length && items.length < limit) {
    const currentChar = content[cursor]
    if (/\s/.test(currentChar)) {
      cursor += 1
      continue
    }

    let matchedText = ''
    const maxLength = Math.min(dictionary.maxTextLength, MAX_TEXT_MATCH_LENGTH, content.length - cursor)
    for (let length = maxLength; length > 0; length -= 1) {
      const candidate = content.slice(cursor, cursor + length)
      if (dictionary.textSet.has(candidate)) {
        matchedText = candidate
        break
      }
    }

    if (!matchedText) {
      matchedText = Array.from(content.slice(cursor))[0] ?? ''
    }

    const codes = getCodesForText(dictionary, matchedText)
    if (codes.length > 0) {
      items.push({ text: matchedText, codes })
    }

    cursor += matchedText.length || 1
  }

  return items
}
