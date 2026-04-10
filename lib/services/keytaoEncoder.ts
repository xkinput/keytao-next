import { pinyin } from 'pinyin-pro'
import * as fs from 'fs'
import * as path from 'path'

// ── Data loading ──────────────────────────────────────────────────────────────

function loadCsv(filePath: string): Record<string, string> {
  const content = fs.readFileSync(filePath, 'utf-8')
  const lines = content.trim().split('\n').slice(1) // skip header
  const map: Record<string, string> = {}
  for (const line of lines) {
    const cols = line.split(',')
    if (cols.length >= 2) map[cols[0].trim()] = cols[1].trim()
  }
  return map
}

const configDir = path.join(process.cwd(), 'config')

// radical char → code (e.g. 人→i, 土→vo)
const ROOT_MAP = loadCsv(path.join(configDir, 'keytao-root.csv'))

// phrase → { c1, c2 }
const SPLIT_MAP: Record<string, { c1: string; c2: string }> = (() => {
  const content = fs.readFileSync(path.join(configDir, 'keytao-split.csv'), 'utf-8')
  const lines = content.trim().split('\n').slice(1)
  const map: Record<string, { c1: string; c2: string }> = {}
  for (const line of lines) {
    const [phrase, c1, c2] = line.split(',')
    if (phrase) map[phrase.trim()] = { c1: (c1 || '').trim(), c2: (c2 || '').trim() }
  }
  return map
})()

// ── Phonetic encoding ─────────────────────────────────────────────────────────

// Zero-initial syllables (a/e/o start, no initial consonant)
const ZERO_INITIAL: Record<string, string> = {
  a: 'xs', ai: 'xh', an: 'xf', ang: 'xp', ao: 'xz',
  e: 'xe', ei: 'xw', en: 'xn', eng: 'xr', er: 'xj',
  o: 'xl', ou: 'xd',
}

// Final → phonetic key
const FINAL_KEY: Record<string, string> = {
  ua: 'q', iu: 'q',
  ei: 'w', un: 'w', vn: 'w', // vn = ün
  e:  'e',
  eng: 'r',
  uan: 't', van: 't', // van = üan
  ong: 'y', iong: 'y',
  ang: 'p',
  a: 's', ia: 's',
  ou: 'd', ie: 'd',
  an: 'f',
  uai: 'g', ing: 'g',
  ai: 'h', ue: 'h', ve: 'h', // ve = üe
  u: 'j', er: 'j',
  i: 'k',
  uo: 'l', v: 'l', o: 'l', ü: 'l', // ü pinyin-pro returns ü directly for j/q/x
  in: 'b', ui: 'b',
  en: 'n',
  ian: 'm',
  iang: 'x',
  iao: 'c',
  ao: 'z',
}

// zh outer finals → Q key as initial
const ZH_OUTER = new Set(['an', 'ang', 'ei', 'en', 'eng', 'u', 'un', 'ai', 'ao', 'e'])
// zh inner finals → F key as initial (uang uses X as final key when zh-inner)
const ZH_INNER = new Set(['a', 'i', 'ong', 'ou', 'ua', 'uai', 'uan', 'uang', 'ui', 'uo'])

// ch outer finals → J key as initial
const CH_OUTER = new Set(['ai', 'an', 'ang', 'en', 'eng', 'u', 'un', 'ao', 'e'])
// ch inner finals → W key as initial (uang uses X as final key when ch-inner)
const CH_INNER = new Set(['a', 'i', 'ong', 'ou', 'ua', 'uai', 'uan', 'uang', 'ui', 'uo'])

function getFinalKey(initial: string, final: string): string {
  if (final === 'uang') {
    // zh-inner(F) and ch-inner(W) use X; all others use M
    return (ZH_INNER.has('uang') && initial === 'zh') ||
           (CH_INNER.has('uang') && initial === 'ch')
      ? 'x' : 'm'
  }
  return FINAL_KEY[final] ?? '?'
}

export function encodePhonetic(initial: string, final: string): string {
  // Normalize tone-stripped pinyin finals
  const fin = final
    .replace(/[āáǎà]/g, 'a').replace(/[ēéěè]/g, 'e').replace(/[īíǐì]/g, 'i')
    .replace(/[ōóǒò]/g, 'o').replace(/[ūúǔù]/g, 'u').replace(/[ǖǘǚǜ]/g, 'v')

  const init = initial.toLowerCase()

  // Zero initial (a/e/o start)
  if (!init) {
    return ZERO_INITIAL[fin] ?? ('x' + (FINAL_KEY[fin] ?? '?'))
  }

  if (init === 'sh') {
    return 'e' + getFinalKey('sh', fin)
  }

  if (init === 'zh') {
    const initKey = ZH_OUTER.has(fin) ? 'q' : 'f'
    return initKey + getFinalKey('zh', fin)
  }

  if (init === 'ch') {
    const initKey = CH_OUTER.has(fin) ? 'j' : 'w'
    return initKey + getFinalKey('ch', fin)
  }

  // j/q/x/y: bare ü (pinyin-pro returns 'u' for yu, 'ü' for ju/qu/xu) → L key
  if (['j', 'q', 'x', 'y'].includes(init) && (fin === 'u' || fin === 'ü')) {
    return init + 'l'
  }

  return init + getFinalKey(init, fin)
}

// ── Shape encoding ────────────────────────────────────────────────────────────

function encodeComponent(component: string): string {
  let code = ''
  for (const ch of component) {
    code += ROOT_MAP[ch] ?? '?'
  }
  return code
}

export function encodeShape(char: string): { c1: string; c2: string; code: string } | null {
  const entry = SPLIT_MAP[char]
  if (!entry) return null
  const c1Code = encodeComponent(entry.c1)
  const c2Code = encodeComponent(entry.c2)
  return { c1: entry.c1, c2: entry.c2, code: c1Code + c2Code }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Returns the 飞键 alternative initial key for zh/ch (if applicable)
function altInitialKey(initial: string, final: string): string | null {
  if (initial === 'zh') {
    // zh 飞键: ai/ao/e can use either Q or F
    if (['ai', 'ao', 'e'].includes(final)) {
      const primary = ZH_OUTER.has(final) ? 'q' : 'f'
      return primary === 'q' ? 'f' : 'q'
    }
  }
  if (initial === 'ch') {
    // ch 飞键: ao/e can use either J or W
    if (['ao', 'e'].includes(final)) {
      const primary = CH_OUTER.has(final) ? 'j' : 'w'
      return primary === 'j' ? 'w' : 'j'
    }
  }
  return null
}

// Returns alternative final key for uang (M↔X)
function altFinalKey(initial: string, final: string): string | null {
  if (final !== 'uang') return null
  const primary = getFinalKey(initial, final)
  return primary === 'm' ? 'x' : 'm'
}

// ── Single character encoding ─────────────────────────────────────────────────

export interface CharEncoding {
  char: string
  pinyin: string
  phoneticCode: string   // 2-key: initial+final
  c1: string | null      // raw c1 radicals from split
  c2: string | null      // raw c2 radicals from split
  shapeCode: string | null // full shape code (c1code+c2code)
  fullCode: string       // phoneticCode + shapeCode
}

export function encodeChar(char: string): CharEncoding {
  const info = pinyin(char, { type: 'all', toneType: 'none' })
  const first = Array.isArray(info) ? info[0] : null

  let phoneticCode = ''
  let pinyinStr = ''

  if (first && first.isZh) {
    pinyinStr = first.pinyin
    phoneticCode = encodePhonetic(first.initial, first.final)
  }

  const shape = encodeShape(char)

  return {
    char,
    pinyin: pinyinStr,
    phoneticCode,
    c1: shape?.c1 ?? null,
    c2: shape?.c2 ?? null,
    shapeCode: shape?.code ?? null,
    fullCode: phoneticCode + (shape?.code ?? ''),
  }
}

// ── Phrase encoding ───────────────────────────────────────────────────────────

export type PhraseType = '单字' | '二字词' | '三字词' | '四字词及以上'

export interface PhraseEncoding {
  input: string
  type: PhraseType
  chars: CharEncoding[]
  // Progressive codes: index 0 = base (minimum keys), each subsequent adds one shape disambiguation key
  codes: string[]
  // 飞键 variants for base code (zh/ch/uang alt positions)
  altCodes: string[]
}

function firstShapeKey(enc: CharEncoding): string {
  return enc.shapeCode?.[0] ?? ''
}

function buildCodes(base: string, shapeSteps: string[]): string[] {
  const codes = [base]
  let current = base
  for (const s of shapeSteps) {
    if (!s) break
    current += s
    codes.push(current)
  }
  return codes
}

function buildAltCodes(
  chars: CharEncoding[],
  pinyinInfos: Array<{ initial: string; final: string }>,
  baseBuilder: (altInitKeys: (string | null)[], altFinKeys: (string | null)[]) => string | null
): string[] {
  const alts: string[] = []

  // Try alt initial for each char that has one
  for (let i = 0; i < chars.length; i++) {
    const { initial, final } = pinyinInfos[i]
    const altInit = altInitialKey(initial, final)
    const altFin = altFinalKey(initial, final)

    if (altInit !== null) {
      const altInitKeys = pinyinInfos.map((_, j) => (j === i ? altInit : null))
      const code = baseBuilder(altInitKeys, pinyinInfos.map(() => null))
      if (code) alts.push(code)
    }
    if (altFin !== null) {
      const altFinKeys = pinyinInfos.map((_, j) => (j === i ? altFin : null))
      const code = baseBuilder(pinyinInfos.map(() => null), altFinKeys)
      if (code) alts.push(code)
    }
  }

  return [...new Set(alts)]
}

export function encodePhrase(word: string): PhraseEncoding {
  const chars = [...word].map(encodeChar)
  const pinyinInfos = chars.map((c) => {
    const info = pinyin(c.char, { type: 'all', toneType: 'none' })
    const first = Array.isArray(info) ? info[0] : null
    return { initial: first?.initial ?? '', final: first?.final ?? '' }
  })

  const n = chars.length
  let type: PhraseType
  let base: string
  let shapeSteps: string[]

  if (n === 1) {
    // 单字: 声+韵 固定两码，形码最多4键（c1首码+c2首码，不足时重复末码）
    type = '单字'
    base = chars[0].phoneticCode
    const shape = chars[0].shapeCode ?? ''
    shapeSteps = shape.split('')
  } else if (n === 2) {
    // 二字词: (声+韵)×2，形消歧最多+2
    type = '二字词'
    base = chars[0].phoneticCode + chars[1].phoneticCode
    shapeSteps = [firstShapeKey(chars[0]), firstShapeKey(chars[1])]
  } else if (n === 3) {
    // 三字词: 声×3，形消歧最多+3
    type = '三字词'
    base = pinyinInfos.map((_, i) => chars[i].phoneticCode[0] ?? '').join('')
    shapeSteps = chars.map(firstShapeKey)
  } else {
    // 四字词及以上: 声×3 + 末声，形消歧最多+2
    type = '四字词及以上'
    const initials = [0, 1, 2, n - 1].map((i) => chars[i].phoneticCode[0] ?? '')
    base = initials.join('')
    shapeSteps = [firstShapeKey(chars[0]), firstShapeKey(chars[1])]
  }

  const codes = buildCodes(base, shapeSteps)

  // Build 飞键 variants for base code
  const altCodes = buildAltCodes(chars, pinyinInfos, (altInitKeys, altFinKeys) => {
    const parts: string[] = []
    for (let i = 0; i < n; i++) {
      if (n === 1 || n === 2) {
        // use full phonetic (声+韵)
        let initKey = chars[i].phoneticCode[0]
        let finKey = chars[i].phoneticCode[1]
        if (altInitKeys[i]) initKey = altInitKeys[i]!
        if (altFinKeys[i]) finKey = altFinKeys[i]!
        parts.push(initKey + finKey)
      } else {
        // use initial only (声); for 4+, only positions 0,1,2,n-1
        if (n >= 4 && i > 2 && i < n - 1) continue
        let initKey = chars[i].phoneticCode[0]
        if (altInitKeys[i]) initKey = altInitKeys[i]!
        parts.push(initKey)
      }
    }
    const code = parts.join('')
    return code !== base ? code : null
  })

  return { input: word, type, chars, codes, altCodes }
}
