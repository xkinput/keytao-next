export type ZdicCacheKind = 'entry' | 'char'
export type ZdicCacheStatus = 'found' | 'absent'

export interface ZdicCachedLookup {
  status: ZdicCacheStatus
  pinyins: string[]
  stale: boolean
}

interface ZdicPinyinCacheRow {
  status: string
  pinyins: unknown
  fetchedAt: Date
}

export interface ZdicLookupCacheClient {
  findUnique(args: {
    where: { kind_entry: { kind: ZdicCacheKind; entry: string } }
    select: { status: true; pinyins: true; fetchedAt: true }
  }): Promise<ZdicPinyinCacheRow | null>
  upsert(args: {
    where: { kind_entry: { kind: ZdicCacheKind; entry: string } }
    create: {
      kind: ZdicCacheKind
      entry: string
      status: ZdicCacheStatus
      pinyins: string[]
      fetchedAt: Date
    }
    update: {
      status: ZdicCacheStatus
      pinyins: string[]
      fetchedAt: Date
    }
  }): Promise<unknown>
}

const ABSENT_TTL_MS = 30 * 24 * 60 * 60 * 1000
const CACHE_OPERATION_TIMEOUT_MS = 1000
const MAX_CACHE_ENTRY_LENGTH = 100
const HAN_ENTRY_PATTERN = /^\p{Script=Han}+$/u
let cacheClientOverride: ZdicLookupCacheClient | undefined

export function setZdicLookupCacheClientForTests(client: ZdicLookupCacheClient | null): void {
  cacheClientOverride = client ?? undefined
}

async function getCacheDelegate(): Promise<ZdicLookupCacheClient> {
  if (cacheClientOverride) return cacheClientOverride
  const { prisma } = await import('@/lib/prisma')
  return (prisma as unknown as { zdicPinyinCache: ZdicLookupCacheClient }).zdicPinyinCache
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isPinyinArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function isCacheableEntry(kind: ZdicCacheKind, entry: string): boolean {
  const length = [...entry].length
  return length >= 1
    && length <= MAX_CACHE_ENTRY_LENGTH
    && HAN_ENTRY_PATTERN.test(entry)
    && (kind !== 'char' || length === 1)
}

async function withCacheTimeout<T>(operation: Promise<T>): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<T>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Zdic cache operation timed out after ${CACHE_OPERATION_TIMEOUT_MS}ms`))
    }, CACHE_OPERATION_TIMEOUT_MS)
  })

  try {
    return await Promise.race([operation, timeout])
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
}

export async function readZdicPinyinCache(
  kind: ZdicCacheKind,
  entry: string,
): Promise<ZdicCachedLookup | null> {
  try {
    const cache = await getCacheDelegate()
    const row = await withCacheTimeout(cache.findUnique({
      where: { kind_entry: { kind, entry } },
      select: { status: true, pinyins: true, fetchedAt: true },
    }))
    if (!row) return null
    if (
      (row.status !== 'found' && row.status !== 'absent')
      || !isPinyinArray(row.pinyins)
      || !(row.fetchedAt instanceof Date)
      || Number.isNaN(row.fetchedAt.getTime())
    ) {
      throw new Error('Invalid zdic cache row')
    }

    return {
      status: row.status,
      pinyins: row.pinyins,
      stale: row.status === 'absent' && Date.now() - row.fetchedAt.getTime() > ABSENT_TTL_MS,
    }
  } catch (error) {
    console.warn('[zdicLookupCache] read failed:', { kind, entry, error: errorMessage(error) })
    return null
  }
}

export async function writeZdicPinyinCache(
  kind: ZdicCacheKind,
  entry: string,
  lookup: { status: ZdicCacheStatus; pinyins: string[] },
): Promise<void> {
  if (!isCacheableEntry(kind, entry)) return

  try {
    const cache = await getCacheDelegate()
    const fetchedAt = new Date()
    await withCacheTimeout(cache.upsert({
      where: { kind_entry: { kind, entry } },
      create: { kind, entry, status: lookup.status, pinyins: lookup.pinyins, fetchedAt },
      update: { status: lookup.status, pinyins: lookup.pinyins, fetchedAt },
    }))
  } catch (error) {
    console.warn('[zdicLookupCache] write failed:', { kind, entry, error: errorMessage(error) })
  }
}
