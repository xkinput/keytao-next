import { NextRequest, NextResponse } from 'next/server'
import { DEFAULT_PRACTICE_ARTICLE_OPTIONS, normalizePracticeArticleText, type PracticeArticleOption } from '@/lib/services/practiceArticles'
import { checkRateLimit } from '@/lib/rateLimit'

export const dynamic = 'force-dynamic'

interface PracticeArticleCache {
  articles: PracticeArticleOption[]
  fetchedAt: number
}

interface WikisourceRandomPage {
  title?: string
  fullurl?: string
}

interface WikisourceRandomResponse {
  query?: {
    pages?: WikisourceRandomPage[]
  }
}

interface WikisourceParseResponse {
  parse?: {
    title?: string
    text?: string
  }
}

const WIKISOURCE_API = 'https://zh.wikisource.org/w/api.php'
const MIN_ARTICLE_TEXT_LENGTH = 700
const MAX_ARTICLE_TEXT_LENGTH = 3200
const REMOTE_ARTICLE_CACHE_TTL_MS = 30 * 60 * 1000

let practiceArticleCache: PracticeArticleCache | null = null

function clientKey(request: NextRequest) {
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwardedFor || request.headers.get('x-real-ip')?.trim() || 'unknown'
}

function decodeHtmlEntities(text: string) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
}

function stripHtmlToPracticeText(html: string) {
  return normalizePracticeArticleText(
    decodeHtmlEntities(
      html
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<table[\s\S]*?<\/table>/gi, ' ')
        .replace(/<sup[\s\S]*?<\/sup>/gi, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(div|p|section|article|li|blockquote|h1|h2|h3|h4|h5|h6)>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
    )
      .replace(/\n{2,}/g, '\n')
      .slice(0, MAX_ARTICLE_TEXT_LENGTH)
  )
}

async function fetchJson<T>(url: string) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'KeyTao-Next',
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`request failed with ${response.status}`)
  }

  return await response.json() as T
}

async function fetchRandomWikisourcePages(limit = 8) {
  const params = new URLSearchParams({
    action: 'query',
    generator: 'random',
    grnnamespace: '0',
    grnlimit: String(limit),
    prop: 'info',
    inprop: 'url',
    format: 'json',
    formatversion: '2',
  })
  const data = await fetchJson<WikisourceRandomResponse>(`${WIKISOURCE_API}?${params.toString()}`)
  return data.query?.pages ?? []
}

async function fetchWikisourceArticle(page: WikisourceRandomPage, index: number) {
  if (!page.title) return null

  const params = new URLSearchParams({
    action: 'parse',
    page: page.title,
    prop: 'text',
    format: 'json',
    formatversion: '2',
  })
  const data = await fetchJson<WikisourceParseResponse>(`${WIKISOURCE_API}?${params.toString()}`)
  const text = stripHtmlToPracticeText(data.parse?.text ?? '')
  if (text.length < MIN_ARTICLE_TEXT_LENGTH) return null

  return {
    id: `wikisource:${index}:${page.title}`,
    title: data.parse?.title ?? page.title,
    text,
    detail: '中文维基文库随机长文',
    url: page.fullurl,
    source: 'wikisource',
  } satisfies PracticeArticleOption
}

async function fetchWikisourcePracticeArticles() {
  const pages = await fetchRandomWikisourcePages(4)

  const dedupedArticles: PracticeArticleOption[] = []
  const seenIds = new Set<string>()
  for (const [index, page] of pages.entries()) {
    const article = await fetchWikisourceArticle(page, index)
    if (!article) continue
    if (seenIds.has(article.id)) continue
    seenIds.add(article.id)
    dedupedArticles.push(article)
    if (dedupedArticles.length >= 3) break
  }

  return dedupedArticles
}

export async function GET(request: NextRequest) {
  const now = Date.now()
  const forceRefresh = request.nextUrl.searchParams.has('refresh')
  const hasFreshCache = Boolean(practiceArticleCache) && (now - (practiceArticleCache?.fetchedAt ?? 0) < REMOTE_ARTICLE_CACHE_TTL_MS)

  if (forceRefresh) {
    const { allowed, retryAfterMs } = checkRateLimit(`practice:articles-refresh:${clientKey(request)}`)
    if (!allowed) {
      return NextResponse.json(
        { error: '请求过于频繁', retryAfterMs },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) },
        }
      )
    }
  }

  if (!forceRefresh && hasFreshCache) {
    return NextResponse.json({
      articles: [...DEFAULT_PRACTICE_ARTICLE_OPTIONS, ...(practiceArticleCache?.articles ?? [])],
      remoteSource: (practiceArticleCache?.articles.length ?? 0) > 0 ? 'wikisource' : null,
      fetchedAt: new Date(practiceArticleCache?.fetchedAt ?? now).toISOString(),
      stale: false,
      cached: true,
    })
  }

  try {
    const remoteArticles = await fetchWikisourcePracticeArticles()
    practiceArticleCache = {
      articles: remoteArticles,
      fetchedAt: now,
    }

    return NextResponse.json({
      articles: [...DEFAULT_PRACTICE_ARTICLE_OPTIONS, ...remoteArticles],
      remoteSource: remoteArticles.length > 0 ? 'wikisource' : null,
      fetchedAt: new Date().toISOString(),
      stale: false,
      cached: false,
    })
  } catch (error) {
    if (practiceArticleCache && practiceArticleCache.articles.length > 0) {
      return NextResponse.json({
        articles: [...DEFAULT_PRACTICE_ARTICLE_OPTIONS, ...practiceArticleCache.articles],
        remoteSource: 'wikisource',
        fetchedAt: new Date(practiceArticleCache.fetchedAt).toISOString(),
        stale: true,
        cached: true,
        error: error instanceof Error ? error.message : 'failed to fetch remote practice articles',
      })
    }

    return NextResponse.json({
      articles: DEFAULT_PRACTICE_ARTICLE_OPTIONS,
      remoteSource: null,
      fetchedAt: new Date().toISOString(),
      stale: false,
      cached: false,
      error: error instanceof Error ? error.message : 'failed to fetch remote practice articles',
    })
  }
}
