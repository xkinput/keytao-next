import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventEmitter as NodeEventEmitter } from 'node:events'

interface HttpsOutcome {
  statusCode: number
  body?: string
}

const httpsMock = vi.hoisted(() => ({
  get: vi.fn(),
  outcomes: [] as HttpsOutcome[],
  timeouts: [] as number[],
}))

const cacheMock = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
}))

vi.mock('https', async () => {
  const { EventEmitter } = await import('node:events')

  httpsMock.get.mockImplementation((
    _url: string,
    _options: unknown,
    callback: (response: NodeEventEmitter & {
      statusCode: number
      headers: Record<string, string>
      resume: () => void
      setEncoding: (_encoding: string) => void
    }) => void,
  ) => {
    const request = new EventEmitter() as NodeEventEmitter & {
      setTimeout: (timeout: number, handler: () => void) => void
      destroy: () => void
    }
    request.setTimeout = (timeout) => {
      httpsMock.timeouts.push(timeout)
    }
    request.destroy = () => undefined

    queueMicrotask(() => {
      const outcome = httpsMock.outcomes.shift()
      if (!outcome) {
        request.emit('error', new Error('Missing mocked HTTPS outcome'))
        return
      }

      const response = new EventEmitter() as NodeEventEmitter & {
        statusCode: number
        headers: Record<string, string>
        resume: () => void
        setEncoding: (_encoding: string) => void
      }
      response.statusCode = outcome.statusCode
      response.headers = {}
      response.resume = () => undefined
      response.setEncoding = () => undefined
      callback(response)

      if (outcome.statusCode >= 200 && outcome.statusCode < 300) {
        queueMicrotask(() => {
          response.emit('data', outcome.body ?? '')
          response.emit('end')
        })
      }
    })

    return request
  })

  return { get: httpsMock.get }
})

import {
  encodeChar,
  encodePhrase,
  getPinyinFromZdic,
  getPinyinsFromZdicEntry,
  resolvePhrasePinyins,
} from '../keytaoEncoder'
import { setZdicLookupCacheClientForTests, writeZdicPinyinCache } from '../zdicLookupCache'

describe('zdic lookup resilience', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    httpsMock.outcomes.length = 0
    httpsMock.timeouts.length = 0
    cacheMock.findUnique.mockReset()
    cacheMock.findUnique.mockResolvedValue(null)
    cacheMock.upsert.mockReset()
    cacheMock.upsert.mockResolvedValue(undefined)
    setZdicLookupCacheClientForTests(cacheMock)
  })

  it('returns a found phrase after one unavailable attempt', async () => {
    httpsMock.outcomes.push(
      { statusCode: 503 },
      { statusCode: 200, body: '<span class="meta-pinyin">chóng shì</span>' },
    )

    const result = await resolvePhrasePinyins('重试')

    expect(result.source).toBe('zdic-phrase')
    expect(result.standardLookup).toBe('found')
    expect(result.pinyins).toEqual(['chóng', 'shì'])
    expect(httpsMock.get).toHaveBeenCalledTimes(2)
    expect(httpsMock.timeouts).toEqual([4000, 4000])
  })

  it('returns unavailable after both attempts are unavailable', async () => {
    httpsMock.outcomes.push(
      { statusCode: 503 },
      { statusCode: 502 },
    )

    const result = await resolvePhrasePinyins('故障')

    expect(result.source).toBe('zdic-unavailable')
    expect(result.standardLookup).toBe('unavailable')
    expect(httpsMock.get).toHaveBeenCalledTimes(2)
    expect(cacheMock.upsert).not.toHaveBeenCalled()
  })

  it('returns absent without retrying a missing phrase', async () => {
    httpsMock.outcomes.push({ statusCode: 404 })

    const result = await resolvePhrasePinyins('缺失')

    expect(result.source).toBe('pinyin-pro-context')
    expect(result.standardLookup).toBe('absent')
    expect(httpsMock.get).toHaveBeenCalledTimes(1)
    expect(cacheMock.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        kind: 'entry',
        entry: '缺失',
        status: 'absent',
        pinyins: [],
      }),
    }))
  })

  it('uses a persistent found entry without making a network request', async () => {
    cacheMock.findUnique.mockResolvedValueOnce({
      kind: 'entry',
      entry: '缓存',
      status: 'found',
      pinyins: ['huǎn', 'cún'],
      fetchedAt: new Date(),
    })

    const result = await getPinyinsFromZdicEntry('缓存')

    expect(result).toEqual(['huǎn', 'cún'])
    expect(httpsMock.get).not.toHaveBeenCalled()
  })

  it('does not revalidate an old persistent found entry', async () => {
    cacheMock.findUnique.mockResolvedValueOnce({
      kind: 'entry',
      entry: '长存',
      status: 'found',
      pinyins: ['cháng', 'cún'],
      fetchedAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000),
    })

    const result = await getPinyinsFromZdicEntry('长存')

    expect(result).toEqual(['cháng', 'cún'])
    expect(httpsMock.get).not.toHaveBeenCalled()
    expect(cacheMock.upsert).not.toHaveBeenCalled()
  })

  it('persists a found live lookup', async () => {
    httpsMock.outcomes.push({
      statusCode: 200,
      body: '<span class="meta-pinyin">chí jiǔ</span>',
    })

    const result = await getPinyinsFromZdicEntry('持久')

    expect(result).toEqual(['chí', 'jiǔ'])
    expect(cacheMock.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        kind: 'entry',
        entry: '持久',
        status: 'found',
        pinyins: ['chí', 'jiǔ'],
      }),
    }))
  })

  it('keeps a live result when the cache write fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    cacheMock.upsert.mockRejectedValueOnce(new Error('Database unavailable'))
    httpsMock.outcomes.push({
      statusCode: 200,
      body: '<span class="meta-pinyin">róng cuò</span>',
    })

    const result = await getPinyinsFromZdicEntry('容错')

    expect(result).toEqual(['róng', 'cuò'])
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(
        '[zdicLookupCache] write failed:',
        expect.objectContaining({ kind: 'entry', entry: '容错' }),
      )
    })
    warn.mockRestore()
  })

  it('returns a live result without waiting for the cache write', async () => {
    let resolveWrite: ((value: unknown) => void) | undefined
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    cacheMock.upsert.mockReturnValueOnce(new Promise(resolve => {
      resolveWrite = resolve
    }))
    httpsMock.outcomes.push({
      statusCode: 200,
      body: '<span class="meta-pinyin">fēi zǔ</span>',
    })

    try {
      const result = await Promise.race([
        getPinyinsFromZdicEntry('非阻'),
        new Promise<never>((_resolve, reject) => {
          timeoutId = setTimeout(() => reject(new Error('Lookup waited for cache write')), 100)
        }),
      ])

      expect(result).toEqual(['fēi', 'zǔ'])
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId)
      resolveWrite?.(undefined)
    }
  })

  it('falls through to a successful live lookup when the cache read fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    cacheMock.findUnique.mockRejectedValueOnce(new Error('Database unavailable'))
    httpsMock.outcomes.push({
      statusCode: 200,
      body: '<span class="meta-pinyin">jiàng jí</span>',
    })

    const result = await getPinyinsFromZdicEntry('降级')

    expect(result).toEqual(['jiàng', 'jí'])
    expect(httpsMock.get).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(
      '[zdicLookupCache] read failed:',
      expect.objectContaining({ kind: 'entry', entry: '降级' }),
    )
    warn.mockRestore()
  })

  it('bounds cache read latency before falling through to a live lookup', async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    cacheMock.findUnique.mockReturnValueOnce(new Promise(() => undefined))
    httpsMock.outcomes.push({
      statusCode: 200,
      body: '<span class="meta-pinyin">chāo shí</span>',
    })

    try {
      const resultPromise = getPinyinsFromZdicEntry('超时')
      await Promise.resolve()
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(1000)
      const result = await resultPromise

      expect(result).toEqual(['chāo', 'shí'])
      expect(httpsMock.get).toHaveBeenCalledTimes(1)
      expect(warn).toHaveBeenCalledWith(
        '[zdicLookupCache] read failed:',
        expect.objectContaining({ kind: 'entry', entry: '超时' }),
      )
    } finally {
      warn.mockRestore()
      vi.useRealTimers()
    }
  })

  it('does not pin stale absent after live revalidation recovers', async () => {
    cacheMock.findUnique.mockResolvedValue({
      kind: 'entry',
      entry: '陈旧',
      status: 'absent',
      pinyins: [],
      fetchedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
    })
    httpsMock.outcomes.push(
      { statusCode: 503 },
      { statusCode: 502 },
    )

    const staleResult = await resolvePhrasePinyins('陈旧')

    expect(staleResult.source).toBe('pinyin-pro-context')
    expect(staleResult.standardLookup).toBe('absent')
    expect(httpsMock.get).toHaveBeenCalledTimes(2)
    expect(cacheMock.upsert).not.toHaveBeenCalled()

    httpsMock.outcomes.push({
      statusCode: 200,
      body: '<span class="meta-pinyin">chén jiù</span>',
    })

    const recoveredResult = await resolvePhrasePinyins('陈旧')

    expect(recoveredResult.source).toBe('zdic-phrase')
    expect(recoveredResult.standardLookup).toBe('found')
    expect(recoveredResult.pinyins).toEqual(['chén', 'jiù'])
    expect(httpsMock.get).toHaveBeenCalledTimes(3)
    await vi.waitFor(() => {
      expect(cacheMock.upsert).toHaveBeenCalledWith(expect.objectContaining({
        create: expect.objectContaining({
          kind: 'entry',
          entry: '陈旧',
          status: 'found',
          pinyins: ['chén', 'jiù'],
        }),
      }))
    })
  })

  it('uses a persistent character lookup without making a network request', async () => {
    cacheMock.findUnique.mockResolvedValueOnce({
      kind: 'char',
      entry: '韧',
      status: 'found',
      pinyins: ['rèn'],
      fetchedAt: new Date(),
    })

    const result = await getPinyinFromZdic('韧')

    expect(result).toEqual(['rèn'])
    expect(cacheMock.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { kind_entry: { kind: 'char', entry: '韧' } },
    }))
    expect(httpsMock.get).not.toHaveBeenCalled()
  })

  it('serves but does not pin a stale absent character after revalidation fails', async () => {
    cacheMock.findUnique.mockResolvedValueOnce({
      kind: 'char',
      entry: '旧',
      status: 'absent',
      pinyins: [],
      fetchedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
    })
    httpsMock.outcomes.push(
      { statusCode: 503 },
      { statusCode: 502 },
    )

    const result = await encodeChar('旧')

    expect(result.pronunciationLookupStatus).toBe('absent')
    expect(httpsMock.get).toHaveBeenCalledTimes(2)
    expect(cacheMock.upsert).not.toHaveBeenCalled()

    httpsMock.outcomes.push({
      statusCode: 200,
      body: '<span class="z_d song">jiù</span>',
    })

    const recoveredResult = await encodeChar('旧')

    expect(recoveredResult.pronunciationLookupStatus).toBe('found')
    expect(recoveredResult.pinyins).toContain('jiù')
    expect(httpsMock.get).toHaveBeenCalledTimes(3)
  })

  it('rejects an invalid cache row and falls through to a live lookup', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    cacheMock.findUnique.mockResolvedValueOnce({
      kind: 'entry',
      entry: '校验',
      status: 'unavailable',
      pinyins: ['jiào', 'yàn'],
      fetchedAt: new Date(),
    })
    httpsMock.outcomes.push({
      statusCode: 200,
      body: '<span class="meta-pinyin">jiào yàn</span>',
    })

    try {
      const result = await getPinyinsFromZdicEntry('校验')

      expect(result).toEqual(['jiào', 'yàn'])
      expect(httpsMock.get).toHaveBeenCalledTimes(1)
      expect(warn).toHaveBeenCalledWith(
        '[zdicLookupCache] read failed:',
        expect.objectContaining({ kind: 'entry', entry: '校验' }),
      )
      await vi.waitFor(() => {
        expect(cacheMock.upsert).toHaveBeenCalledTimes(1)
      })
    } finally {
      warn.mockRestore()
    }
  })

  it('skips writes for invalid or oversized cache keys', async () => {
    const lookup = { status: 'absent' as const, pinyins: [] }

    await writeZdicPinyinCache('entry', '', lookup)
    await writeZdicPinyinCache('entry', 'not-han', lookup)
    await writeZdicPinyinCache('entry', `汉${'a'.repeat(10)}`, lookup)
    await writeZdicPinyinCache('entry', '汉'.repeat(101), lookup)
    await writeZdicPinyinCache('char', '汉字', lookup)

    expect(cacheMock.upsert).not.toHaveBeenCalled()
  })

  it('uses warm character readings when the whole-word page is absent', async () => {
    cacheMock.findUnique
      .mockResolvedValueOnce({
        kind: 'char',
        entry: '吃',
        status: 'found',
        pinyins: ['chī'],
        fetchedAt: new Date(),
      })
      .mockResolvedValueOnce({
        kind: 'char',
        entry: '席',
        status: 'found',
        pinyins: ['xí'],
        fetchedAt: new Date(),
      })
      .mockResolvedValueOnce(null)

    await getPinyinFromZdic('吃')
    await getPinyinFromZdic('席')
    httpsMock.outcomes.push({ statusCode: 404 })

    const result = await encodePhrase('吃席')

    expect(result.pronunciationSource).toBe('pinyin-pro-context')
    expect(result.standardPronunciationStatus).toBe('absent')
    expect(result.chars.map(char => char.pronunciationLookupStatus)).toEqual(['found', 'found'])
    expect(httpsMock.get).toHaveBeenCalledTimes(1)
  })
})
