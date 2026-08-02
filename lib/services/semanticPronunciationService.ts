import type { SemanticPronunciation } from './keytaoEncoder'
import { createHash } from 'node:crypto'

interface BotPronunciationResponse {
  success?: boolean
  accepted?: boolean
  word?: string
  pinyins?: unknown
  meaning?: unknown
  confidence?: unknown
}

interface CacheEntry {
  expiresAt: number
  value: SemanticPronunciation | null
}

const acceptedTtlMs = 6 * 60 * 60 * 1000
const rejectedTtlMs = 10 * 60 * 1000
const maxCacheEntries = 512
const cache = new Map<string, CacheEntry>()
const inFlight = new Map<string, Promise<SemanticPronunciation | null>>()
const pinyinSyllablePattern = /^[a-zA-ZüÜāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜvV]+$/u

function timeoutMs(): number {
  const configured = Number(process.env.SEMANTIC_PRONUNCIATION_TIMEOUT_MS || 30_000)
  if (!Number.isFinite(configured)) return 30_000
  return Math.min(Math.max(configured, 3_000), 60_000)
}

function parseResponse(word: string, data: BotPronunciationResponse): SemanticPronunciation | null {
  const meaning = typeof data.meaning === 'string' ? data.meaning.trim() : ''
  const confidence = Number(data.confidence)
  const pinyins = Array.isArray(data.pinyins)
    ? data.pinyins.map(item => typeof item === 'string' ? item.trim() : '')
    : []

  if (
    data.success !== true
    || data.accepted !== true
    || data.word !== word
    || !Number.isFinite(confidence)
    || confidence < 0.75
    || meaning.length < 4
    || meaning.length > 160
    || pinyins.length !== [...word].length
    || pinyins.some(item => !item || item.length > 16 || !pinyinSyllablePattern.test(item))
  ) {
    return null
  }

  return { pinyins, meaning }
}

function remember(word: string, value: SemanticPronunciation | null): void {
  const ttl = value ? acceptedTtlMs : rejectedTtlMs
  cache.set(word, { expiresAt: Date.now() + ttl, value })
  if (cache.size <= maxCacheEntries) return

  const oldest = cache.keys().next().value
  if (oldest) cache.delete(oldest)
}

async function fetchSemanticPronunciation(
  word: string,
  baseUrl: string,
  apiKey: string,
  requesterId: string,
): Promise<SemanticPronunciation | null> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs())
  try {
    const response = await fetch(`${baseUrl}/api/keytao/pronunciation`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-KeyTao-Requester': createHash('sha256').update(requesterId || 'anonymous').digest('hex'),
      },
      body: JSON.stringify({ word }),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`Semantic pronunciation service returned ${response.status}`)
    const data = await response.json() as BotPronunciationResponse
    return parseResponse(word, data)
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function requestSemanticPronunciation(
  word: string,
  requesterId = 'anonymous',
): Promise<SemanticPronunciation | null> {
  const normalizedWord = word.trim()
  const apiKey = process.env.BOT_API_KEY || ''
  if (!normalizedWord || !apiKey) return null

  const cached = cache.get(normalizedWord)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  if (cached) cache.delete(normalizedWord)

  const active = inFlight.get(normalizedWord)
  if (active) return active

  const baseUrl = (process.env.BOT_API_URL || 'http://localhost:8080').replace(/\/+$/, '')
  const task = fetchSemanticPronunciation(normalizedWord, baseUrl, apiKey, requesterId)
    .then(value => {
      remember(normalizedWord, value)
      return value
    })
    .finally(() => {
      if (inFlight.get(normalizedWord) === task) inFlight.delete(normalizedWord)
    })
  inFlight.set(normalizedWord, task)
  return task
}
