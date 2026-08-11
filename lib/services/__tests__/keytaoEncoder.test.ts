import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { EventEmitter as NodeEventEmitter } from 'node:events'

const cacheMock = {
  findUnique: vi.fn().mockResolvedValue(null),
  upsert: vi.fn().mockResolvedValue(undefined),
}

vi.mock('https', async () => {
  const { EventEmitter } = await import('node:events')

  const htmlByEntry: Record<string, string> = {
    '好': '<span class="z_d song">hǎo</span>',
    '你': '<span class="z_d song">nǐ</span>',
    '中': '<span class="z_d song">zhōng</span>',
    '国': '<span class="z_d song">guó</span>',
    '学': '<span class="z_d song">xué</span>',
    '爱': '<span class="z_d song">ài</span>',
    '阿': '<title>阿 ā、ē - 汉典</title>',
    '勒': '<title>勒 lè、lēi - 汉典</title>',
    '泰': '<span class="z_d song">tài</span>',
    '噪': '<title>噪 a - 汉典</title><span class="z_d song">a</span>',
    '咋': '<span class="z_d song">zǎ</span><span class="z_d song">zhā</span>',
    '呼': '<span class="z_d song">hū</span>',
    '尊': '<span class="z_d song">zūn</span>',
    '行': '<span class="z_d song">háng</span><span class="z_d song">xíng</span>',
    '长': '<span class="z_d song">cháng</span><span class="z_d song">zhǎng</span>',
    '鳜': '<title>鳜 guì、jué - 汉典</title><span class="z_d song">not-pinyin</span>',
    '鱼': '<span class="z_d song">yú</span>',
    '小': '<span class="z_d song">xiǎo</span>',
    '藏': '<span class="z_d song">cáng</span><span class="z_d song">zàng</span>',
    '羚': '<span class="z_d song">líng</span>',
    '复': '<span class="z_d song">fù</span>',
    '购': '<span class="z_d song">gòu</span>',
    '率': '<span class="z_d song">shuài</span><span class="z_d song">lǜ</span>',
    '表': '<span class="z_d song">biǎo</span>',
    '你好': '<span class="meta-pinyin">nǐ hǎo</span>',
    '中国': '<span class="meta-pinyin">zhōng guó</span>',
    '咋呼': '<span class="meta-pinyin">zhā hū</span>',
    '尊行': '<span class="meta-pinyin">zūn xíng</span>',
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
        const statusCode = entry === '复购率' ? 429 : body ? 200 : 404
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

import { analyzeRequestedCode, buildPhraseEncodingFromChars, encodePhonetic, getPhrasePinyins, parsePinyin, getPinyinFromZdic, encodeChar, encodePhrase, type CharEncoding } from '../keytaoEncoder'
import { setZdicLookupCacheClientForTests } from '../zdicLookupCache'

beforeAll(() => {
  setZdicLookupCacheClientForTests(cacheMock)
})

// encodePhonetic(initial, final) → 2-char phonetic code
// finals are as returned by pinyin-pro (toneType:'none')

describe('encodePhonetic', () => {
  // ── Zero-initial syllables ──────────────────────────────────────────────────
  describe('zero initial', () => {
    it.each([
      ['', 'a', 'xs'],
      ['', 'ai', 'xh'],
      ['', 'an', 'xf'],
      ['', 'ang', 'xp'],
      ['', 'ao', 'xz'],
      ['', 'e', 'xe'],
      ['', 'ei', 'xw'],
      ['', 'en', 'xn'],
      ['', 'eng', 'xr'],
      ['', 'er', 'xj'],
      ['', 'o', 'xl'],
      ['', 'ou', 'xd'],
    ])('(%s, %s) → %s', (init, fin, expected) => {
      expect(encodePhonetic(init, fin)).toBe(expected)
    })
  })

  // ── Regular initials (单键声母) ─────────────────────────────────────────────
  describe('regular initials', () => {
    it.each([
      // b
      ['b', 'a', 'bs'],
      ['b', 'an', 'bf'],
      ['b', 'ang', 'bp'],
      ['b', 'ao', 'bz'],
      ['b', 'ei', 'bw'],
      ['b', 'en', 'bn'],
      ['b', 'eng', 'br'],
      ['b', 'i', 'bk'],
      ['b', 'in', 'bb'],
      ['b', 'ing', 'bg'],
      ['b', 'o', 'bl'],
      ['b', 'u', 'bj'],
      // p
      ['p', 'a', 'ps'],
      ['p', 'o', 'pl'],
      ['p', 'ang', 'pp'],
      // m
      ['m', 'a', 'ms'],
      ['m', 'o', 'ml'],
      ['m', 'en', 'mn'],
      // f
      ['f', 'a', 'fs'],
      ['f', 'an', 'ff'],
      ['f', 'eng', 'fr'],
      ['f', 'ou', 'fd'],
      ['f', 'u', 'fj'],
      // d
      ['d', 'a', 'ds'],
      ['d', 'an', 'df'],
      ['d', 'ang', 'dp'],
      ['d', 'ao', 'dz'],
      ['d', 'e', 'de'],
      ['d', 'ei', 'dw'],
      ['d', 'eng', 'dr'],
      ['d', 'i', 'dk'],
      ['d', 'ian', 'dm'],
      ['d', 'iao', 'dc'],
      ['d', 'ie', 'dd'],
      ['d', 'ing', 'dg'],
      ['d', 'iu', 'dq'],
      ['d', 'ong', 'dy'],
      ['d', 'ou', 'dd'],
      ['d', 'u', 'dj'],
      ['d', 'uan', 'dt'],
      ['d', 'ui', 'db'],
      ['d', 'un', 'dw'],
      ['d', 'uo', 'dl'],
      // t
      ['t', 'a', 'ts'],
      ['t', 'uan', 'tt'],
      // n
      ['n', 'a', 'ns'],
      ['n', 'uan', 'nt'],
      // l
      ['l', 'a', 'ls'],
      ['l', 'uan', 'lt'],
      // g
      ['g', 'a', 'gs'],
      ['g', 'an', 'gf'],
      ['g', 'ang', 'gp'],
      ['g', 'ao', 'gz'],
      ['g', 'e', 'ge'],
      ['g', 'ei', 'gw'],
      ['g', 'eng', 'gr'],
      ['g', 'ou', 'gd'],
      ['g', 'u', 'gj'],
      ['g', 'ua', 'gq'],
      ['g', 'uai', 'gg'],
      ['g', 'uan', 'gt'],
      ['g', 'uang', 'gm'],
      ['g', 'ui', 'gb'],
      ['g', 'un', 'gw'],
      ['g', 'uo', 'gl'],
      // k
      ['k', 'uan', 'kt'],
      // h
      ['h', 'uan', 'ht'],
      // r
      ['r', 'an', 'rf'],
      ['r', 'ang', 'rp'],
      ['r', 'ao', 'rz'],
      ['r', 'e', 're'],
      ['r', 'en', 'rn'],
      ['r', 'eng', 'rr'],
      ['r', 'i', 'rk'],
      ['r', 'ong', 'ry'],
      ['r', 'ou', 'rd'],
      ['r', 'u', 'rj'],
      ['r', 'ua', 'rq'],
      ['r', 'uan', 'rt'],
      ['r', 'ui', 'rb'],
      ['r', 'un', 'rw'],
      ['r', 'uo', 'rl'],
      // s
      ['s', 'an', 'sf'],
      ['s', 'uan', 'st'],
      // z
      ['z', 'an', 'zf'],
      ['z', 'uan', 'zt'],
    ])('(%s, %s) → %s', (init, fin, expected) => {
      expect(encodePhonetic(init, fin)).toBe(expected)
    })
  })

  // ── j / q / x / y — ü family finals (pinyin-pro returns plain ü) ────────────
  describe('j/q/x/y with ü-family finals', () => {
    it.each([
      // bare ü → L key
      ['j', 'ü', 'jl'],  // 居
      ['q', 'ü', 'ql'],  // 取
      ['x', 'ü', 'xl'],  // 虚 (note: same as x+iang? No, xiang→xx, xu→xl)
      ['y', 'u', 'yl'],  // 鱼 (y-initial: pinyin-pro returns 'u' not 'ü')
      // üan → T key (was returning '?' before fix)
      ['j', 'üan', 'jt'],  // 卷
      ['q', 'üan', 'qt'],  // 全
      ['x', 'üan', 'xt'],  // 选
      ['y', 'uan', 'yt'],  // 圆 (y-initial uses 'uan')
      // üe → H key
      ['j', 'üe', 'jh'],  // 绝
      ['q', 'üe', 'qh'],  // 缺
      ['x', 'üe', 'xh'],  // 学 (note: overlaps x+ei? No: xei→xw)
      ['y', 'ue', 'yh'],  // 月 (y-initial uses 'ue')
      // ün → W key
      ['j', 'ün', 'jw'],  // 君
      ['q', 'ün', 'qw'],  // 群
      ['x', 'ün', 'xw'],  // 寻
      ['y', 'un', 'yw'],  // 云 (y-initial uses 'un')
    ])('(%s, %s) → %s', (init, fin, expected) => {
      expect(encodePhonetic(init, fin)).toBe(expected)
    })
  })

  // ── sh — always E as initial key ───────────────────────────────────────────
  describe('sh initial', () => {
    it.each([
      ['sh', 'a', 'es'],
      ['sh', 'ai', 'eh'],
      ['sh', 'an', 'ef'],
      ['sh', 'ang', 'ep'],
      ['sh', 'ao', 'ez'],
      ['sh', 'e', 'ee'],
      ['sh', 'ei', 'ew'],
      ['sh', 'en', 'en'],
      ['sh', 'eng', 'er'],
      ['sh', 'i', 'ek'],
      ['sh', 'ou', 'ed'],
      ['sh', 'u', 'ej'],
      ['sh', 'ua', 'eq'],
      ['sh', 'uai', 'eg'],
      ['sh', 'uan', 'et'],
      ['sh', 'uang', 'em'],
      ['sh', 'ui', 'eb'],
      ['sh', 'un', 'ew'],
      ['sh', 'uo', 'el'],
    ])('(%s, %s) → %s', (init, fin, expected) => {
      expect(encodePhonetic(init, fin)).toBe(expected)
    })
  })

  // ── zh — outer→Q, inner→F ──────────────────────────────────────────────────
  describe('zh initial (outer=Q, inner=F)', () => {
    it.each([
      // outer finals → Q
      ['zh', 'ai', 'qh'],
      ['zh', 'an', 'qf'],
      ['zh', 'ang', 'qp'],
      ['zh', 'ao', 'qz'],
      ['zh', 'e', 'qe'],
      ['zh', 'ei', 'qw'],
      ['zh', 'en', 'qn'],
      ['zh', 'eng', 'qr'],
      ['zh', 'u', 'qj'],
      ['zh', 'un', 'qw'],
      // inner finals → F
      ['zh', 'a', 'fs'],
      ['zh', 'i', 'fk'],
      ['zh', 'ong', 'fy'],
      ['zh', 'ou', 'fd'],
      ['zh', 'ua', 'fq'],
      ['zh', 'uai', 'fg'],
      ['zh', 'uan', 'ft'],
      ['zh', 'ui', 'fb'],
      ['zh', 'uo', 'fl'],
      // uang: inner → X key as final
      ['zh', 'uang', 'fx'],
    ])('(%s, %s) → %s', (init, fin, expected) => {
      expect(encodePhonetic(init, fin)).toBe(expected)
    })
  })

  // ── ch — outer→J, inner→W ──────────────────────────────────────────────────
  describe('ch initial (outer=J, inner=W)', () => {
    it.each([
      // outer finals → J
      ['ch', 'ai', 'jh'],
      ['ch', 'an', 'jf'],
      ['ch', 'ang', 'jp'],
      ['ch', 'ao', 'jz'],
      ['ch', 'e', 'je'],
      ['ch', 'en', 'jn'],
      ['ch', 'eng', 'jr'],
      ['ch', 'u', 'jj'],
      ['ch', 'un', 'jw'],
      // inner finals → W
      ['ch', 'a', 'ws'],
      ['ch', 'i', 'wk'],
      ['ch', 'ong', 'wy'],
      ['ch', 'ou', 'wd'],
      ['ch', 'ua', 'wq'],
      ['ch', 'uai', 'wg'],
      ['ch', 'uan', 'wt'],
      ['ch', 'ui', 'wb'],
      ['ch', 'uo', 'wl'],
      // uang: inner → X key as final
      ['ch', 'uang', 'wx'],
    ])('(%s, %s) → %s', (init, fin, expected) => {
      expect(encodePhonetic(init, fin)).toBe(expected)
    })
  })

  // ── uang final — zh/ch inner use X, others use M ───────────────────────────
  describe('uang final', () => {
    it.each([
      ['zh', 'uang', 'fx'],  // zh inner → X
      ['ch', 'uang', 'wx'],  // ch inner → X
      ['g', 'uang', 'gm'],  // regular → M
      ['h', 'uang', 'hm'],
      ['k', 'uang', 'km'],
      ['sh', 'uang', 'em'],
    ])('(%s, %s) → %s', (init, fin, expected) => {
      expect(encodePhonetic(init, fin)).toBe(expected)
    })
  })

  // ── Tone-marked input normalization ────────────────────────────────────────
  describe('tone normalization', () => {
    it.each([
      ['g', 'uān', 'gt'],  // ā → a in uan
      ['g', 'uán', 'gt'],
      ['g', 'uǎn', 'gt'],
      ['g', 'uàn', 'gt'],
    ])('(%s, %s) → %s', (init, fin, expected) => {
      expect(encodePhonetic(init, fin)).toBe(expected)
    })
  })
})

// ── parsePinyin ──────────────────────────────────────────────────────────────

describe('parsePinyin', () => {
  it.each([
    // common toned inputs from zdic
    ['hǎo', { initial: 'h', final: 'ao' }],
    ['nǐ', { initial: 'n', final: 'i' }],
    ['zhōng', { initial: 'zh', final: 'ong' }],
    ['chē', { initial: 'ch', final: 'e' }],
    ['shū', { initial: 'sh', final: 'u' }],
    ['jiān', { initial: 'j', final: 'ian' }],
    ['quán', { initial: 'q', final: 'uan' }],
    ['xuě', { initial: 'x', final: 'ue' }],
    ['yú', { initial: 'y', final: 'u' }],
    ['wǒ', { initial: 'w', final: 'o' }],
    // zero-initial
    ['ān', { initial: '', final: 'an' }],
    ['ér', { initial: '', final: 'er' }],
    ['ōu', { initial: '', final: 'ou' }],
    // tone-stripped (as stored in cache)
    ['hao', { initial: 'h', final: 'ao' }],
    ['zhong', { initial: 'zh', final: 'ong' }],
  ])('parsePinyin(%s) → %o', (input, expected) => {
    expect(parsePinyin(input)).toEqual(expected)
  })
})

describe('phrase-level pinyin disambiguation', () => {
  it.each([
    ['吓了', ['xià', 'le']],
    ['了解', ['liǎo', 'jiě']],
    ['为了', ['wèi', 'le']],
    ['知了', ['zhī', 'liǎo']],
    ['读着', ['dú', 'zhe']],
    ['学着', ['xué', 'zhe']],
    ['着想', ['zhuó', 'xiǎng']],
    ['小藏羚', ['xiǎo', 'zàng', 'líng']],
    ['复购率', ['fù', 'gòu', 'lǜ']],
    ['表率', ['biǎo', 'shuài']],
  ])('resolves contextual pinyin for %s', (word, expected) => {
    expect(getPhrasePinyins(word)).toEqual(expected)
  })

  it('encodes 吓了 with le instead of liao', () => {
    const result = buildPhraseEncodingFromChars('吓了', [
      charEncoding('吓', 'xià', 'xs', 'ovio'),
      charEncoding('了', 'le', 'le', 'ai'),
    ])

    expect(result.codes).toEqual(['xsle', 'xsleo', 'xsleoa'])
  })
})

function charEncoding(char: string, pinyin: string, phoneticCode: string, shapeCode: string): CharEncoding {
  return {
    char,
    pinyin,
    pinyins: [pinyin],
    phoneticCode,
    c1: null,
    c2: null,
    shapeCode,
    fullCode: phoneticCode + shapeCode,
  }
}

describe('fixed fly-key phrase variants', () => {
  it('generates combined zh fly-key series for repeated zh syllables', () => {
    const result = buildPhraseEncodingFromChars('啫啫煲', [
      charEncoding('啫', 'zhě', 'qe', 'ouov'),
      charEncoding('啫', 'zhě', 'qe', 'ouov'),
      charEncoding('煲', 'bāo', 'bz', 'ioou'),
    ])

    expect(result.codes).toEqual(['qqb', 'qqbo', 'qqboo', 'qqbooi'])
    expect(result.flyKeyVariants.map(variant => variant.baseCode)).toEqual(['fqb', 'qfb', 'ffb'])
    expect(result.flyKeyVariants.find(variant => variant.baseCode === 'ffb')?.codes).toEqual(['ffb', 'ffbo', 'ffboo', 'ffbooi'])
    expect(result.altCodes).toContain('ffb')
    expect(result.altCodes).toContain('ffbooi')
  })

  it('generates combined ch fly-key series only for fixed ch fly finals', () => {
    const result = buildPhraseEncodingFromChars('车车包', [
      charEncoding('车', 'chē', 'je', 'vo'),
      charEncoding('车', 'chē', 'je', 'vo'),
      charEncoding('包', 'bāo', 'bz', 'av'),
    ])

    expect(result.codes[0]).toBe('jjb')
    expect(result.flyKeyVariants.map(variant => variant.baseCode)).toEqual(['wjb', 'jwb', 'wwb'])
  })

  it('analyzes user-requested fixed fly-key codes and unsupported same-series codes', () => {
    const result = buildPhraseEncodingFromChars('啫啫煲', [
      charEncoding('啫', 'zhě', 'qe', 'ouov'),
      charEncoding('啫', 'zhě', 'qe', 'ouov'),
      charEncoding('煲', 'bāo', 'bz', 'ioou'),
    ])

    const supported = analyzeRequestedCode(result, 'ffb')
    expect(supported.supported).toBe(true)
    expect(supported.matchType).toBe('flyKey')
    expect(supported.seriesCodes).toEqual(['ffb', 'ffbo', 'ffboo', 'ffbooi'])

    const sameSeries = analyzeRequestedCode(result, 'ffba')
    expect(sameSeries.supported).toBe(false)
    expect(sameSeries.matchType).toBe('sameSeries')
    expect(sameSeries.seriesCodes).toEqual(['ffb', 'ffbo', 'ffboo', 'ffbooi'])
  })
})

// getPinyinFromZdic uses mocked zdic fixtures.
// The file-level HTTPS mock keeps parser coverage deterministic and offline.

describe('getPinyinFromZdic', { timeout: 15000 }, () => {
  it('parses single-vowel pinyin from the real 阿 title', async () => {
    const result = await getPinyinFromZdic('阿')
    expect(result).toEqual(['ā', 'ē'])
  })

  it('parses multiple pinyin syllables from the 勒 title', async () => {
    const result = await getPinyinFromZdic('勒')
    expect(result).toEqual(['lè', 'lēi'])
  })

  it('rejects bare untoned single-letter noise from spans and titles', async () => {
    const result = await getPinyinFromZdic('噪')
    expect(result).toEqual([])
  })

  it('parses pinyin from the title when reading spans are unusable', async () => {
    const result = await getPinyinFromZdic('鳜')
    expect(result).toEqual(['guì', 'jué'])
  })

  it.each([
    ['好', 'hǎo'],
    ['你', 'nǐ'],
    ['中', 'zhōng'],
    ['学', 'xué'],
    ['爱', 'ài'],
  ])('fetches pinyin for "%s" → first reading is "%s"', async (char, expected) => {
    const result = await getPinyinFromZdic(char)
    expect(result).toBeInstanceOf(Array)
    expect(result.length).toBeGreaterThan(0)
    // normalize tones for robust comparison
    const strip = (s: string) =>
      s.replace(/[āáǎà]/g, 'a').replace(/[ēéěè]/g, 'e').replace(/[īíǐì]/g, 'i')
        .replace(/[ōóǒò]/g, 'o').replace(/[ūúǔù]/g, 'u').replace(/[ǖǘǚǜ]/g, 'ü')
    expect(strip(result[0])).toBe(strip(expected))
  })
})

// encodeChar and encodePhrase use mocked zdic fixtures.

describe('encodeChar', { timeout: 15000 }, () => {
  it('encodes 好 correctly', async () => {
    const r = await encodeChar('好')
    expect(r.char).toBe('好')
    expect(r.phoneticCode).toBe('hz')
  })

  it('encodes 中 correctly', async () => {
    const r = await encodeChar('中')
    expect(r.char).toBe('中')
    expect(r.phoneticCode).toBe('fy')
  })

  it('encodes 鳜 correctly (rare char, guì)', async () => {
    const r = await encodeChar('鳜')
    expect(r.char).toBe('鳜')
    expect(r.pinyin).toBe('guì')
    expect(r.phoneticCode).toBe('gb')
  })
})

describe('encodePhrase', { timeout: 30000 }, () => {
  it('encodes 阿勒泰 without zdic-unavailable when character lookups succeed', async () => {
    const result = await encodePhrase('阿勒泰')

    expect(result.pronunciationSource).not.toBe('zdic-unavailable')
    expect(result.chars.map(char => char.pronunciationLookupStatus)).toEqual(['found', 'found', 'found'])
  })

  it('encodes 你好 (2-char)', async () => {
    const r = await encodePhrase('你好')
    expect(r.type).toBe('二字词')
    expect(r.codes[0]).toBe('nkhz')
  })

  it('encodes 中国 (2-char)', async () => {
    const r = await encodePhrase('中国')
    expect(r.type).toBe('二字词')
    // 中→fy, 国→gl
    expect(r.codes[0]).toBe('fygl')
  })

  it('encodes 咋呼 using the word-level zhā hū reading', async () => {
    const r = await encodePhrase('咋呼')
    expect(r.chars.map(c => c.pinyin)).toEqual(['zhā', 'hū'])
    expect(r.codes[0]).toBe('fshj')
  })

  it('encodes 咋咋呼呼 from the verified 咋呼 base reading', async () => {
    const r = await encodePhrase('咋咋呼呼')
    expect(r.chars.map(c => c.pinyin)).toEqual(['zhā', 'zhā', 'hū', 'hū'])
    expect(r.codes[0]).toBe('ffhh')
  })

  it('encodes 尊行 using xíng from the word-level reading', async () => {
    const r = await encodePhrase('尊行')
    expect(r.chars.map(c => c.pinyin)).toEqual(['zūn', 'xíng'])
    expect(r.codes[0]).toBe('zwxg')
  })

  it('encodes 鳜鱼 (rare polyphonic phrase)', async () => {
    const r = await encodePhrase('鳜鱼')
    expect(r.type).toBe('二字词')
    // 鳜→guì→gb, 鱼→yú→yl
    expect(r.chars[0].pinyin).toBe('guì')
    expect(r.chars[0].phoneticCode).toBe('gb')
    expect(r.chars[1].phoneticCode).toBe('yl')
    expect(r.codes[0]).toBe('gbyl')
  })

  it('encodes 小藏羚 with zàng instead of cáng', async () => {
    const r = await encodePhrase('小藏羚')
    expect(r.type).toBe('三字词')
    expect(r.chars.map(c => c.pinyin)).toEqual(['xiǎo', 'zàng', 'líng'])
    expect(r.chars[1].phoneticCode).toBe('zp')
    expect(r.codes[0]).toBe('xzl')
  })

  it('encodes 复购率 with the contextual lǜ reading', async () => {
    const r = await encodePhrase('复购率')
    expect(r.type).toBe('三字词')
    expect(r.chars.map(c => c.pinyin)).toEqual(['fù', 'gòu', 'lǜ'])
    expect(r.chars[2].phoneticCode).toBe('ll')
    expect(r.codes).toEqual(['fgl', 'fglu', 'fglua', 'fgluao'])
  })

  it('keeps the shuài reading for 表率', async () => {
    const r = await encodePhrase('表率')
    expect(r.chars.map(c => c.pinyin)).toEqual(['biǎo', 'shuài'])
    expect(r.chars[1].phoneticCode).toBe('eg')
  })
})

// Polyphonic character tests use mocked zdic fixtures.
// Each uncached character exercises the mocked HTTPS parser path once.

describe('getPinyinFromZdic polyphonic chars', { timeout: 30000 }, () => {
  it('行 returns all readings: háng and xíng', async () => {
    const result = await getPinyinFromZdic('行')
    expect(result).toContain('háng')
    expect(result).toContain('xíng')
    expect(result[0]).toBe('háng') // most common first
  })

  it('长 returns all readings: cháng and zhǎng', async () => {
    const result = await getPinyinFromZdic('长')
    expect(result).toContain('cháng')
    expect(result).toContain('zhǎng')
    expect(result[0]).toBe('cháng')
  })

})
