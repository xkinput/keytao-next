import { describe, expect, it } from 'vitest'
import { encodePhonetic } from '../keytaoEncoder'

// encodePhonetic(initial, final) → 2-char phonetic code
// finals are as returned by pinyin-pro (toneType:'none')

describe('encodePhonetic', () => {
  // ── Zero-initial syllables ──────────────────────────────────────────────────
  describe('zero initial', () => {
    it.each([
      ['', 'a',   'xs'],
      ['', 'ai',  'xh'],
      ['', 'an',  'xf'],
      ['', 'ang', 'xp'],
      ['', 'ao',  'xz'],
      ['', 'e',   'xe'],
      ['', 'ei',  'xw'],
      ['', 'en',  'xn'],
      ['', 'eng', 'xr'],
      ['', 'er',  'xj'],
      ['', 'o',   'xl'],
      ['', 'ou',  'xd'],
    ])('(%s, %s) → %s', (init, fin, expected) => {
      expect(encodePhonetic(init, fin)).toBe(expected)
    })
  })

  // ── Regular initials (单键声母) ─────────────────────────────────────────────
  describe('regular initials', () => {
    it.each([
      // b
      ['b', 'a',   'bs'],
      ['b', 'an',  'bf'],
      ['b', 'ang', 'bp'],
      ['b', 'ao',  'bz'],
      ['b', 'ei',  'bw'],
      ['b', 'en',  'bn'],
      ['b', 'eng', 'br'],
      ['b', 'i',   'bk'],
      ['b', 'in',  'bb'],
      ['b', 'ing', 'bg'],
      ['b', 'o',   'bl'],
      ['b', 'u',   'bj'],
      // p
      ['p', 'a',   'ps'],
      ['p', 'o',   'pl'],
      ['p', 'ang', 'pp'],
      // m
      ['m', 'a',   'ms'],
      ['m', 'o',   'ml'],
      ['m', 'en',  'mn'],
      // f
      ['f', 'a',   'fs'],
      ['f', 'an',  'ff'],
      ['f', 'eng', 'fr'],
      ['f', 'ou',  'fd'],
      ['f', 'u',   'fj'],
      // d
      ['d', 'a',   'ds'],
      ['d', 'an',  'df'],
      ['d', 'ang', 'dp'],
      ['d', 'ao',  'dz'],
      ['d', 'e',   'de'],
      ['d', 'ei',  'dw'],
      ['d', 'eng', 'dr'],
      ['d', 'i',   'dk'],
      ['d', 'ian', 'dm'],
      ['d', 'iao', 'dc'],
      ['d', 'ie',  'dd'],
      ['d', 'ing', 'dg'],
      ['d', 'iu',  'dq'],
      ['d', 'ong', 'dy'],
      ['d', 'ou',  'dd'],
      ['d', 'u',   'dj'],
      ['d', 'uan', 'dt'],
      ['d', 'ui',  'db'],
      ['d', 'un',  'dw'],
      ['d', 'uo',  'dl'],
      // t
      ['t', 'a',   'ts'],
      ['t', 'uan', 'tt'],
      // n
      ['n', 'a',   'ns'],
      ['n', 'uan', 'nt'],
      // l
      ['l', 'a',   'ls'],
      ['l', 'uan', 'lt'],
      // g
      ['g', 'a',   'gs'],
      ['g', 'an',  'gf'],
      ['g', 'ang', 'gp'],
      ['g', 'ao',  'gz'],
      ['g', 'e',   'ge'],
      ['g', 'ei',  'gw'],
      ['g', 'eng', 'gr'],
      ['g', 'ou',  'gd'],
      ['g', 'u',   'gj'],
      ['g', 'ua',  'gq'],
      ['g', 'uai', 'gg'],
      ['g', 'uan', 'gt'],
      ['g', 'uang','gm'],
      ['g', 'ui',  'gb'],
      ['g', 'un',  'gw'],
      ['g', 'uo',  'gl'],
      // k
      ['k', 'uan', 'kt'],
      // h
      ['h', 'uan', 'ht'],
      // r
      ['r', 'an',  'rf'],
      ['r', 'ang', 'rp'],
      ['r', 'ao',  'rz'],
      ['r', 'e',   're'],
      ['r', 'en',  'rn'],
      ['r', 'eng', 'rr'],
      ['r', 'i',   'rk'],
      ['r', 'ong', 'ry'],
      ['r', 'ou',  'rd'],
      ['r', 'u',   'rj'],
      ['r', 'ua',  'rq'],
      ['r', 'uan', 'rt'],
      ['r', 'ui',  'rb'],
      ['r', 'un',  'rw'],
      ['r', 'uo',  'rl'],
      // s
      ['s', 'an',  'sf'],
      ['s', 'uan', 'st'],
      // z
      ['z', 'an',  'zf'],
      ['z', 'uan', 'zt'],
    ])('(%s, %s) → %s', (init, fin, expected) => {
      expect(encodePhonetic(init, fin)).toBe(expected)
    })
  })

  // ── j / q / x / y — ü family finals (pinyin-pro returns plain ü) ────────────
  describe('j/q/x/y with ü-family finals', () => {
    it.each([
      // bare ü → L key
      ['j', 'ü',   'jl'],  // 居
      ['q', 'ü',   'ql'],  // 取
      ['x', 'ü',   'xl'],  // 虚 (note: same as x+iang? No, xiang→xx, xu→xl)
      ['y', 'u',   'yl'],  // 鱼 (y-initial: pinyin-pro returns 'u' not 'ü')
      // üan → T key (was returning '?' before fix)
      ['j', 'üan', 'jt'],  // 卷
      ['q', 'üan', 'qt'],  // 全
      ['x', 'üan', 'xt'],  // 选
      ['y', 'uan', 'yt'],  // 圆 (y-initial uses 'uan')
      // üe → H key
      ['j', 'üe',  'jh'],  // 绝
      ['q', 'üe',  'qh'],  // 缺
      ['x', 'üe',  'xh'],  // 学 (note: overlaps x+ei? No: xei→xw)
      ['y', 'ue',  'yh'],  // 月 (y-initial uses 'ue')
      // ün → W key
      ['j', 'ün',  'jw'],  // 君
      ['q', 'ün',  'qw'],  // 群
      ['x', 'ün',  'xw'],  // 寻
      ['y', 'un',  'yw'],  // 云 (y-initial uses 'un')
    ])('(%s, %s) → %s', (init, fin, expected) => {
      expect(encodePhonetic(init, fin)).toBe(expected)
    })
  })

  // ── sh — always E as initial key ───────────────────────────────────────────
  describe('sh initial', () => {
    it.each([
      ['sh', 'a',   'es'],
      ['sh', 'ai',  'eh'],
      ['sh', 'an',  'ef'],
      ['sh', 'ang', 'ep'],
      ['sh', 'ao',  'ez'],
      ['sh', 'e',   'ee'],
      ['sh', 'ei',  'ew'],
      ['sh', 'en',  'en'],
      ['sh', 'eng', 'er'],
      ['sh', 'i',   'ek'],
      ['sh', 'ou',  'ed'],
      ['sh', 'u',   'ej'],
      ['sh', 'ua',  'eq'],
      ['sh', 'uai', 'eg'],
      ['sh', 'uan', 'et'],
      ['sh', 'uang','em'],
      ['sh', 'ui',  'eb'],
      ['sh', 'un',  'ew'],
      ['sh', 'uo',  'el'],
    ])('(%s, %s) → %s', (init, fin, expected) => {
      expect(encodePhonetic(init, fin)).toBe(expected)
    })
  })

  // ── zh — outer→Q, inner→F ──────────────────────────────────────────────────
  describe('zh initial (outer=Q, inner=F)', () => {
    it.each([
      // outer finals → Q
      ['zh', 'ai',  'qh'],
      ['zh', 'an',  'qf'],
      ['zh', 'ang', 'qp'],
      ['zh', 'ao',  'qz'],
      ['zh', 'e',   'qe'],
      ['zh', 'ei',  'qw'],
      ['zh', 'en',  'qn'],
      ['zh', 'eng', 'qr'],
      ['zh', 'u',   'qj'],
      ['zh', 'un',  'qw'],
      // inner finals → F
      ['zh', 'a',   'fs'],
      ['zh', 'i',   'fk'],
      ['zh', 'ong', 'fy'],
      ['zh', 'ou',  'fd'],
      ['zh', 'ua',  'fq'],
      ['zh', 'uai', 'fg'],
      ['zh', 'uan', 'ft'],
      ['zh', 'ui',  'fb'],
      ['zh', 'uo',  'fl'],
      // uang: inner → X key as final
      ['zh', 'uang','fx'],
    ])('(%s, %s) → %s', (init, fin, expected) => {
      expect(encodePhonetic(init, fin)).toBe(expected)
    })
  })

  // ── ch — outer→J, inner→W ──────────────────────────────────────────────────
  describe('ch initial (outer=J, inner=W)', () => {
    it.each([
      // outer finals → J
      ['ch', 'ai',  'jh'],
      ['ch', 'an',  'jf'],
      ['ch', 'ang', 'jp'],
      ['ch', 'ao',  'jz'],
      ['ch', 'e',   'je'],
      ['ch', 'en',  'jn'],
      ['ch', 'eng', 'jr'],
      ['ch', 'u',   'jj'],
      ['ch', 'un',  'jw'],
      // inner finals → W
      ['ch', 'a',   'ws'],
      ['ch', 'i',   'wk'],
      ['ch', 'ong', 'wy'],
      ['ch', 'ou',  'wd'],
      ['ch', 'ua',  'wq'],
      ['ch', 'uai', 'wg'],
      ['ch', 'uan', 'wt'],
      ['ch', 'ui',  'wb'],
      ['ch', 'uo',  'wl'],
      // uang: inner → X key as final
      ['ch', 'uang','wx'],
    ])('(%s, %s) → %s', (init, fin, expected) => {
      expect(encodePhonetic(init, fin)).toBe(expected)
    })
  })

  // ── uang final — zh/ch inner use X, others use M ───────────────────────────
  describe('uang final', () => {
    it.each([
      ['zh', 'uang', 'fx'],  // zh inner → X
      ['ch', 'uang', 'wx'],  // ch inner → X
      ['g',  'uang', 'gm'],  // regular → M
      ['h',  'uang', 'hm'],
      ['k',  'uang', 'km'],
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
