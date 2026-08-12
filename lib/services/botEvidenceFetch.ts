export const BOT_EVIDENCE_TEXT_LIMIT = 12_000
export const BOT_EVIDENCE_WORD_LIMIT = 100

const RAW_HTML_LIMIT = 150_000
const FETCH_ATTEMPT_TIMEOUT_MS = 4_000
const FETCH_RETRY_BACKOFF_MS = 300
const MAX_REDIRECTS = 2
const CACHE_OPERATION_TIMEOUT_MS = 1_000
const FOUND_TTL_MS = 7 * 24 * 60 * 60 * 1_000
const ABSENT_TTL_MS = 24 * 60 * 60 * 1_000
const HAN_WORD_PATTERN = /^\p{Script=Han}+$/u

export type BotEvidenceSourceId =
  | 'handian'
  | 'moedict'
  | 'hwxnet_cidian'
  | 'hwxnet_xinhua'
  | 'baidu_baike'
  | 'wikipedia'

type WordScope = 'all' | 'single_character' | 'multi_character'

interface EvidenceSourcePolicy {
  hostname: string
  hostnameAliases?: readonly string[]
  buildUrl: (encodedWord: string) => string
  followExactWordAnchor: boolean
  wordScope: WordScope
}

// This hardcoded source allowlist is the endpoint's primary security boundary.
// Never accept a caller-supplied URL or turn this into a generic fetch proxy.
const EVIDENCE_SOURCES: Record<BotEvidenceSourceId, EvidenceSourcePolicy> = {
  handian: {
    hostname: 'www.zdic.net',
    hostnameAliases: ['zdic.net'],
    buildUrl: word => `https://www.zdic.net/hans/${word}`,
    followExactWordAnchor: false,
    wordScope: 'all',
  },
  moedict: {
    hostname: 'www.moedict.tw',
    buildUrl: word => `https://www.moedict.tw/${word}`,
    followExactWordAnchor: false,
    wordScope: 'all',
  },
  hwxnet_cidian: {
    hostname: 'cd.hwxnet.com',
    buildUrl: word => `https://cd.hwxnet.com/search.do?wd=${word}`,
    followExactWordAnchor: true,
    wordScope: 'multi_character',
  },
  hwxnet_xinhua: {
    hostname: 'zd.hwxnet.com',
    buildUrl: word => `https://zd.hwxnet.com/search.do?wd=${word}`,
    followExactWordAnchor: true,
    wordScope: 'single_character',
  },
  baidu_baike: {
    hostname: 'baike.baidu.com',
    buildUrl: word => `https://baike.baidu.com/item/${word}`,
    followExactWordAnchor: false,
    wordScope: 'all',
  },
  wikipedia: {
    hostname: 'zh.wikipedia.org',
    buildUrl: word => `https://zh.wikipedia.org/wiki/${word}`,
    followExactWordAnchor: false,
    wordScope: 'all',
  },
}

export interface BotEvidenceFetchPayload {
  ok: boolean
  status: number
  text: string
}

type FetchResult =
  | { status: 'found'; html: string }
  | { status: 'absent' }
  | { status: 'unavailable'; retryable: boolean }

type CachedResult =
  | { status: 'found'; text: string }
  | { status: 'absent'; text: null }

interface BotEvidenceCacheRow {
  status: string
  text: string | null
  fetchedAt: Date
}

interface BotEvidenceCacheClient {
  findUnique(args: {
    where: { sourceId_word: { sourceId: BotEvidenceSourceId; word: string } }
    select: { status: true; text: true; fetchedAt: true }
  }): Promise<BotEvidenceCacheRow | null>
  upsert(args: {
    where: { sourceId_word: { sourceId: BotEvidenceSourceId; word: string } }
    create: {
      sourceId: BotEvidenceSourceId
      word: string
      status: 'found' | 'absent'
      text: string | null
      fetchedAt: Date
    }
    update: {
      status: 'found' | 'absent'
      text: string | null
      fetchedAt: Date
    }
  }): Promise<unknown>
}

export function isBotEvidenceSourceId(value: unknown): value is BotEvidenceSourceId {
  return typeof value === 'string'
    && Object.prototype.hasOwnProperty.call(EVIDENCE_SOURCES, value)
}

export function isValidBotEvidenceWord(sourceId: BotEvidenceSourceId, word: unknown): word is string {
  if (typeof word !== 'string') return false
  const length = [...word].length
  if (length < 1 || length > BOT_EVIDENCE_WORD_LIMIT || !HAN_WORD_PATTERN.test(word)) return false

  const scope = EVIDENCE_SOURCES[sourceId].wordScope
  return scope === 'all'
    || (scope === 'single_character' && length === 1)
    || (scope === 'multi_character' && length > 1)
}

async function getCacheDelegate(): Promise<BotEvidenceCacheClient> {
  const { prisma } = await import('@/lib/prisma')
  return (prisma as unknown as { botEvidenceCache: BotEvidenceCacheClient }).botEvidenceCache
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function withCacheTimeout<T>(operation: Promise<T>): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<T>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Bot evidence cache operation timed out after ${CACHE_OPERATION_TIMEOUT_MS}ms`))
    }, CACHE_OPERATION_TIMEOUT_MS)
  })

  try {
    return await Promise.race([operation, timeout])
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
}

async function readCache(
  sourceId: BotEvidenceSourceId,
  word: string,
): Promise<CachedResult | null> {
  try {
    const cache = await getCacheDelegate()
    const row = await withCacheTimeout(cache.findUnique({
      where: { sourceId_word: { sourceId, word } },
      select: { status: true, text: true, fetchedAt: true },
    }))
    if (!row) return null
    if (
      !(row.fetchedAt instanceof Date)
      || Number.isNaN(row.fetchedAt.getTime())
      || (row.status === 'found' && typeof row.text !== 'string')
      || (row.status === 'absent' && row.text !== null)
      || (row.status !== 'found' && row.status !== 'absent')
    ) {
      throw new Error('Invalid bot evidence cache row')
    }

    const ttl = row.status === 'found' ? FOUND_TTL_MS : ABSENT_TTL_MS
    if (Date.now() - row.fetchedAt.getTime() >= ttl) return null
    return row.status === 'found'
      ? { status: 'found', text: row.text as string }
      : { status: 'absent', text: null }
  } catch (error) {
    console.warn('[botEvidenceFetch] cache read failed:', {
      sourceId,
      error: errorMessage(error),
    })
    return null
  }
}

async function writeCache(
  sourceId: BotEvidenceSourceId,
  word: string,
  value: CachedResult,
): Promise<void> {
  try {
    const cache = await getCacheDelegate()
    const fetchedAt = new Date()
    await withCacheTimeout(cache.upsert({
      where: { sourceId_word: { sourceId, word } },
      create: {
        sourceId,
        word,
        status: value.status,
        text: value.text,
        fetchedAt,
      },
      update: {
        status: value.status,
        text: value.text,
        fetchedAt,
      },
    }))
  } catch (error) {
    console.warn('[botEvidenceFetch] cache write failed:', {
      sourceId,
      error: errorMessage(error),
    })
  }
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  }

  return value.replace(/&(#(?:x[0-9a-f]+|\d+)|[a-z]+);/gi, (entity, token: string) => {
    if (token.startsWith('#')) {
      const hexadecimal = token[1]?.toLowerCase() === 'x'
      const digits = token.slice(hexadecimal ? 2 : 1)
      const codePoint = Number.parseInt(digits, hexadecimal ? 16 : 10)
      if (Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff) {
        try {
          return String.fromCodePoint(codePoint)
        } catch {
          return entity
        }
      }
      return entity
    }
    return named[token.toLowerCase()] ?? entity
  })
}

function stripHtml(value: string): string {
  const withoutActiveContent = value.replace(
    /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
    ' ',
  )
  const withoutTags = withoutActiveContent.replace(/<[^>]+>/g, ' ')
  return decodeHtmlEntities(withoutTags).replace(/\s+/g, ' ').trim()
}

function boundText(value: string): string {
  return [...value].slice(0, BOT_EVIDENCE_TEXT_LIMIT).join('')
}

function isAllowedUrl(url: URL, allowedHostnames: readonly string[]): boolean {
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
  return url.protocol === 'https:'
    && allowedHostnames.includes(hostname)
    && url.port === ''
    && !url.username
    && !url.password
}

function decodeUtf8LocationHeader(value: string): string {
  const bytes = new Uint8Array(value.length)
  let hasNonAsciiByte = false

  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit > 0xff) return value
    bytes[index] = codeUnit
    hasNonAsciiByte ||= codeUnit >= 0x80
  }

  if (!hasNonAsciiByte) return value
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return value
  }
}

function resolveAndNormalizeRedirectUrl(location: string, baseUrl: URL): URL {
  const decodedLocation = decodeUtf8LocationHeader(location)
  // URL resolution encodes raw Unicode in paths and queries while preserving percent escapes.
  return new URL(decodedLocation, baseUrl)
}

async function readBoundedHtml(response: Response): Promise<string> {
  if (!response.body) return ''

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let html = ''
  while (html.length < RAW_HTML_LIMIT) {
    const { done, value } = await reader.read()
    if (done) {
      html += decoder.decode()
      break
    }
    html += decoder.decode(value, { stream: true })
  }
  if (html.length >= RAW_HTML_LIMIT) {
    await reader.cancel().catch(() => undefined)
  }
  return html.slice(0, RAW_HTML_LIMIT)
}

async function fetchAttempt(
  initialUrl: string,
  allowedHostnames: readonly string[],
): Promise<FetchResult> {
  let currentUrl = new URL(initialUrl)
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), FETCH_ATTEMPT_TIMEOUT_MS)

  try {
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      if (!isAllowedUrl(currentUrl, allowedHostnames)) {
        return { status: 'unavailable', retryable: false }
      }

      const response = await fetch(currentUrl.toString(), {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; keytao-evidence-fetch/1.0)' },
        redirect: 'manual',
        signal: controller.signal,
      })

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        await response.body?.cancel().catch(() => undefined)
        if (!location || redirectCount === MAX_REDIRECTS) {
          return { status: 'unavailable', retryable: false }
        }
        const redirectedUrl = resolveAndNormalizeRedirectUrl(location, currentUrl)
        if (!isAllowedUrl(redirectedUrl, allowedHostnames)) {
          return { status: 'unavailable', retryable: false }
        }
        currentUrl = redirectedUrl
        continue
      }

      if (response.status === 404 || response.status === 410) {
        await response.body?.cancel().catch(() => undefined)
        return { status: 'absent' }
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        return { status: 'unavailable', retryable: true }
      }
      return { status: 'found', html: await readBoundedHtml(response) }
    }
  } catch {
    return { status: 'unavailable', retryable: true }
  } finally {
    clearTimeout(timeoutId)
  }

  return { status: 'unavailable', retryable: false }
}

async function resilientFetch(url: string, allowedHostnames: readonly string[]): Promise<FetchResult> {
  const first = await fetchAttempt(url, allowedHostnames)
  if (first.status !== 'unavailable' || !first.retryable) return first

  await new Promise(resolve => setTimeout(resolve, FETCH_RETRY_BACKOFF_MS))
  return fetchAttempt(url, allowedHostnames)
}

function exactWordSameDomainAnchorUrl(
  html: string,
  searchUrl: string,
  allowedHostnames: readonly string[],
  word: string,
): string {
  const search = new URL(searchUrl)
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi
  for (const anchor of html.matchAll(anchorPattern)) {
    const attributes = anchor[1] ?? ''
    const renderedText = stripHtml(anchor[2] ?? '')
    const hrefMatch = /\bhref\s*=\s*(['"])([\s\S]*?)\1/i.exec(attributes)
    if (!hrefMatch || renderedText !== word) continue

    try {
      const candidate = new URL(decodeHtmlEntities(hrefMatch[2]).trim(), search)
      if (
        candidate.protocol === search.protocol
        && isAllowedUrl(candidate, allowedHostnames)
      ) {
        return candidate.toString()
      }
    } catch {
      continue
    }
  }
  return ''
}

export async function fetchBotEvidence(
  sourceId: BotEvidenceSourceId,
  word: string,
): Promise<BotEvidenceFetchPayload> {
  const cached = await readCache(sourceId, word)
  if (cached?.status === 'found') {
    return { ok: true, status: 200, text: cached.text }
  }
  if (cached?.status === 'absent') {
    return { ok: false, status: 404, text: '' }
  }

  const source = EVIDENCE_SOURCES[sourceId]
  const allowedHostnames = [source.hostname, ...(source.hostnameAliases ?? [])]
  const initialUrl = source.buildUrl(encodeURIComponent(word))
  let result = await resilientFetch(initialUrl, allowedHostnames)

  if (result.status === 'found' && source.followExactWordAnchor) {
    const entryUrl = exactWordSameDomainAnchorUrl(
      result.html,
      initialUrl,
      allowedHostnames,
      word,
    )
    result = entryUrl
      ? await resilientFetch(entryUrl, allowedHostnames)
      : { status: 'absent' }
  }

  if (result.status === 'absent') {
    await writeCache(sourceId, word, { status: 'absent', text: null })
    return { ok: false, status: 404, text: '' }
  }
  if (result.status === 'unavailable') {
    return { ok: false, status: 502, text: '' }
  }

  const text = boundText(stripHtml(result.html))
  await writeCache(sourceId, word, { status: 'found', text })
  return { ok: true, status: 200, text }
}
