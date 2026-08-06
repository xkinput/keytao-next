import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventEmitter as NodeEventEmitter } from 'node:events'
import { NextRequest } from 'next/server'

const routeMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  checkRateLimit: vi.fn(),
  requestSemanticPronunciation: vi.fn(),
  verifyBotToken: vi.fn(),
  zdicFindUnique: vi.fn(),
  zdicUpsert: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    phrase: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    zdicPinyinCache: {
      findUnique: routeMocks.zdicFindUnique,
      upsert: routeMocks.zdicUpsert,
    },
  },
}))

vi.mock('@/lib/auth', () => ({ getSession: routeMocks.getSession }))
vi.mock('@/lib/rateLimit', () => ({ checkRateLimit: routeMocks.checkRateLimit }))
vi.mock('@/lib/services/semanticPronunciationService', () => ({
  requestSemanticPronunciation: routeMocks.requestSemanticPronunciation,
}))
vi.mock('@/lib/botAuth', () => ({ verifyBotToken: routeMocks.verifyBotToken }))

vi.mock('https', async () => {
  const { EventEmitter } = await import('node:events')

  const htmlByEntry: Record<string, string> = {
    '攀': '<span class="z_d song">pān</span>',
    '复': '<span class="z_d song">fù</span>',
    '购': '<span class="z_d song">gòu</span>',
    '率': '<span class="z_d song">shuài</span><span class="z_d song">lǜ</span>',
    '看': '<span class="z_d song">kàn</span>',
    '行': '<span class="z_d song">xíng</span><span class="z_d song">háng</span>',
    '长': '<span class="z_d song">cháng</span><span class="z_d song">zhǎng</span>',
    '行长': '<span class="meta-pinyin">háng zhǎng</span>',
    '着': [
      '<span class="z_d song">zhuó</span>',
      '<span class="z_d song">zháo</span>',
      '<span class="z_d song">zhāo</span>',
      '<span class="z_d song">zhe</span>',
    ].join(''),
  }

  return {
    get: vi.fn((url: string, _options: unknown, callback: (response: NodeEventEmitter & {
      statusCode: number
      headers: Record<string, string>
      resume: () => void
      setEncoding: (_encoding: string) => void
    }) => void) => {
      const request = new EventEmitter() as NodeEventEmitter & {
        setTimeout: (_timeout: number, _handler: () => void) => void
        destroy: () => void
      }
      request.setTimeout = () => undefined
      request.destroy = () => undefined

      queueMicrotask(() => {
        const entry = decodeURIComponent(new URL(url).pathname.replace('/hans/', ''))
        const body = htmlByEntry[entry]
        const statusCode = (
          entry === '看着'
          || entry === '复购率'
          || ['测试', '测', '试'].includes(entry)
        ) ? 429 : body ? 200 : 404
        const response = new EventEmitter() as NodeEventEmitter & {
          statusCode: number
          headers: Record<string, string>
          resume: () => void
          setEncoding: (_encoding: string) => void
        }
        response.statusCode = statusCode
        response.headers = {}
        response.resume = () => undefined
        response.setEncoding = () => undefined
        callback(response)
        if (body && statusCode >= 200 && statusCode < 300) {
          queueMicrotask(() => {
            response.emit('data', body)
            response.emit('end')
          })
        }
      })

      return request
    }),
  }
})

import { analyzeRequestedCode, encodePhrase, getPhrasePinyins, parsePinyin } from '../keytaoEncoder'
import { inferPhrase, inferPhrases } from '../phraseInference'
import { GET as encodePhraseRoute } from '../../../app/api/phrases/encode/route'
import { GET as inferPhraseRoute } from '../../../app/api/phrases/infer/route'
import { GET as botEncodePhraseRoute } from '../../../app/api/bot/phrases/encode/route'
import { setZdicLookupCacheClientForTests } from '../zdicLookupCache'

function stripTone(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').replaceAll('ü', 'v')
}

describe('semantic phrase pronunciation fallback', () => {
  beforeEach(() => {
    routeMocks.getSession.mockResolvedValue(null)
    routeMocks.checkRateLimit.mockReturnValue({ allowed: true, retryAfterMs: 0 })
    routeMocks.requestSemanticPronunciation.mockResolvedValue(null)
    routeMocks.verifyBotToken.mockResolvedValue(true)
    routeMocks.zdicFindUnique.mockResolvedValue(null)
    routeMocks.zdicUpsert.mockResolvedValue(undefined)
    setZdicLookupCacheClientForTests({
      findUnique: routeMocks.zdicFindUnique,
      upsert: routeMocks.zdicUpsert,
    })
    vi.clearAllMocks()
  })

  it('accepts pan zhe only with a concrete meaning and known character readings', async () => {
    expect(getPhrasePinyins('攀着').map(stripTone)).toEqual(['pan', 'zhe'])

    const fallback = await encodePhrase('攀着')
    expect(fallback.chars.map(char => stripTone(char.pinyin))).toEqual(['pan', 'zhuo'])
    expect(fallback.codes[0]).toBe('pffl')
    expect(fallback.pronunciationSource).toBe('zdic-character-default')
    expect(fallback.contextPhrasePinyins?.map(stripTone)).toEqual(['pan', 'zhe'])
    expect(fallback.semanticPronunciationNeeded).toBe(true)
    expect(fallback.semanticPronunciationAccepted).toBe(false)

    const missingMeaning = await encodePhrase('攀着', {
      semanticPronunciation: {
        pinyins: ['pan', 'zhe'],
        meaning: '',
      },
    })
    expect(missingMeaning.codes[0]).toBe('pffl')
    expect(missingMeaning.semanticPronunciationAccepted).toBe(false)

    const hallucinated = await encodePhrase('攀着', {
      semanticPronunciation: {
        pinyins: ['pan', 'zhi'],
        meaning: '表示正攀附着或抓住某物向上移动',
      },
    })
    expect(hallucinated.codes[0]).toBe('pffl')
    expect(hallucinated.semanticPronunciationAccepted).toBe(false)

    const result = await encodePhrase('攀着', {
      semanticPronunciation: {
        pinyins: ['pan', 'zhe'],
        meaning: '表示正攀附着或抓住某物向上移动',
      },
    })

    expect(result.chars.map(char => stripTone(char.pinyin))).toEqual(['pan', 'zhe'])
    expect(result.codes[0]).toBe('pfqe')
    expect(result.pronunciationSource).toBe('llm-semantic')
    expect(result.semanticPronunciationAccepted).toBe(true)
  })

  it('normalizes the common LLM v spelling to ü', () => {
    expect(parsePinyin('lv')).toEqual({ initial: 'l', final: 'ü' })
    expect(parsePinyin('lve')).toEqual({ initial: 'l', final: 'üe' })
  })

  it('lets the trusted infer layer supply a meaning-gated semantic pronunciation', async () => {
    const result = await inferPhrase('攀着', undefined, {
      semanticPronunciationResolver: async () => ({
        pinyins: ['pan', 'zhe'],
        meaning: '表示正攀附着或抓住某物向上移动',
      }),
    })

    expect(result.phrasePinyins?.map(stripTone)).toEqual(['pan', 'zhe'])
    expect(result.codes[0]).toBe('pfqe')
    expect(result.pronunciationSource).toBe('llm-semantic')
  })

  it('does not auto-fill an unresolved ambiguous pronunciation', async () => {
    const result = await inferPhrase('攀着')

    expect(result.semanticPronunciationNeeded).toBe(true)
    expect(result.suggestion).toBeNull()
    expect(result.suggestionStatus).toBe('pronunciation-unresolved')

    const analysis = analyzeRequestedCode(await encodePhrase('攀着'), 'pffl')
    expect(analysis.supported).toBe(false)
    expect(analysis.alternatives).toEqual([])
    expect(analysis.message).toContain('读音存在歧义')

    const [batchResult] = await inferPhrases(['攀着'])
    expect(batchResult.suggestion).toBeNull()
    expect(batchResult.suggestionStatus).toBe('pronunciation-unresolved')
  })

  it('keeps an authoritative whole-word pronunciation over a conflicting semantic proposal', async () => {
    const result = await encodePhrase('行长', {
      semanticPronunciation: {
        pinyins: ['xing', 'chang'],
        meaning: '某一行业里年长的人',
      },
    })

    expect(result.phrasePinyins?.map(stripTone)).toEqual(['hang', 'zhang'])
    expect(result.pronunciationSource).toBe('zdic-phrase')
    expect(result.semanticPronunciationAccepted).toBe(false)
  })

  it('requires a meaning-backed reading that agrees with phrase context when authority is unavailable', async () => {
    const unresolved = await encodePhrase('看着')
    expect(unresolved.pronunciationSource).toBe('zdic-unavailable')
    expect(unresolved.standardPronunciationStatus).toBe('unavailable')
    expect(unresolved.semanticPronunciationNeeded).toBe(true)
    expect(unresolved.semanticPronunciationAccepted).toBe(false)

    const conflicting = await encodePhrase('看着', {
      semanticPronunciation: {
        pinyins: ['kan', 'zhuo'],
        meaning: '把视线放在某个对象上并持续观察',
      },
    })
    expect(conflicting.pronunciationSource).toBe('zdic-unavailable')
    expect(conflicting.semanticPronunciationAccepted).toBe(false)

    const result = await encodePhrase('看着', {
      semanticPronunciation: {
        pinyins: ['kan', 'zhe'],
        meaning: '把视线放在某个对象上并持续观察',
      },
    })

    expect(result.pronunciationSource).toBe('llm-semantic')
    expect(result.standardPronunciationStatus).toBe('unavailable')
    expect(result.semanticPronunciationNeeded).toBe(false)
    expect(result.semanticPronunciationAccepted).toBe(true)

    const inferred = await inferPhrase('看着', undefined, {
      semanticPronunciationResolver: async () => ({
        pinyins: ['kan', 'zhe'],
        meaning: '把视线放在某个对象上并持续观察',
      }),
    })
    expect(inferred.pronunciationSource).toBe('llm-semantic')
    expect(inferred.standardPronunciationStatus).toBe('unavailable')
    expect(inferred.suggestion).not.toBeNull()
    expect(inferred.suggestionStatus).toBe('available')
  })

  it('keeps an unambiguous contextual reading usable during an authority outage', async () => {
    const encoding = await encodePhrase('复购率')
    expect(encoding.phrasePinyins?.map(stripTone)).toEqual(['fu', 'gou', 'lu'])
    expect(encoding.contextPhrasePinyins?.map(stripTone)).toEqual(['fu', 'gou', 'lu'])
    expect(encoding.codes[0]).toBe('fgl')
    expect(encoding.pronunciationSource).toBe('pinyin-pro-context')
    expect(encoding.standardPronunciationStatus).toBe('unavailable')
    expect(encoding.semanticPronunciationNeeded).toBe(false)

    const inferred = await inferPhrase('复购率')
    expect(inferred.suggestion).toBe('fgl')
    expect(inferred.suggestionStatus).toBe('available')
  })

  it('does not trust pinyin-pro alone when both phrase and character lookups are unavailable', async () => {
    const encoding = await encodePhrase('测试')
    expect(encoding.phrasePinyins?.map(stripTone)).toEqual(['ce', 'shi'])
    expect(encoding.contextPhrasePinyins?.map(stripTone)).toEqual(['ce', 'shi'])
    expect(encoding.chars.every(char => char.pronunciationLookupStatus === 'unavailable')).toBe(true)
    expect(encoding.pronunciationSource).toBe('zdic-unavailable')
    expect(encoding.standardPronunciationStatus).toBe('unavailable')
    expect(encoding.semanticPronunciationNeeded).toBe(false)

    const inferred = await inferPhrase('测试')
    expect(inferred.suggestion).toBeNull()
    expect(inferred.suggestionStatus).toBe('pronunciation-unavailable')
  })

  it('uses the authenticated infer route to request semantic pronunciation', async () => {
    routeMocks.getSession.mockResolvedValue({ id: 7, name: 'Rea' })
    routeMocks.requestSemanticPronunciation.mockResolvedValue({
      pinyins: ['pan', 'zhe'],
      meaning: '表示正攀附着或抓住某物向上移动',
    })

    const response = await inferPhraseRoute(new NextRequest('http://localhost/api/phrases/infer?word=攀着'))
    const result = await response.json()

    expect(response.status).toBe(200)
    expect(routeMocks.checkRateLimit).toHaveBeenCalledWith('semantic-pronunciation:7')
    expect(routeMocks.requestSemanticPronunciation).toHaveBeenCalledWith('攀着', '7')
    expect(result.codes[0]).toBe('pfqe')
    expect(result.pronunciationSource).toBe('llm-semantic')
  })

  it('does not trust semantic claims sent to the public encode route', async () => {
    const params = new URLSearchParams({
      word: '攀着',
      semantic_pinyin: 'pan zhe',
      semantic_meaning: '表示正攀附着或抓住某物向上移动',
    })
    const response = await encodePhraseRoute(new NextRequest(`http://localhost/api/phrases/encode?${params}`))
    const result = await response.json()

    expect(response.status).toBe(200)
    expect(result.phrasePinyins.map(stripTone)).toEqual(['pan', 'zhuo'])
    expect(result.codes[0]).toBe('pffl')
    expect(result.pronunciationSource).toBe('zdic-character-default')
    expect(result.semanticPronunciationAccepted).toBe(false)
  })

  it('accepts semantic claims only on the bot-authenticated encode route', async () => {
    const params = new URLSearchParams({
      word: '攀着',
      semantic_pinyin: 'pan zhe',
      semantic_meaning: '表示正攀附着或抓住某物向上移动',
    })
    routeMocks.verifyBotToken.mockResolvedValue(false)
    const unauthorized = await botEncodePhraseRoute(
      new NextRequest(`http://localhost/api/bot/phrases/encode?${params}`),
    )
    expect(unauthorized.status).toBe(401)

    routeMocks.verifyBotToken.mockResolvedValue(true)
    const response = await botEncodePhraseRoute(
      new NextRequest(`http://localhost/api/bot/phrases/encode?${params}`),
    )
    const result = await response.json()
    expect(response.status).toBe(200)
    expect(result.codes[0]).toBe('pfqe')
    expect(result.pronunciationSource).toBe('llm-semantic')
  })
})
