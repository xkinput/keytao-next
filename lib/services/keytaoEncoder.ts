import * as fs from 'fs'
import * as https from 'https'
import * as path from 'path'
import { customPinyin, pinyin } from 'pinyin-pro'
import { appendCodeWithinMaxLength } from '@/lib/constants/codeValidation'
import { readZdicPinyinCache, writeZdicPinyinCache } from './zdicLookupCache'

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

const PHRASE_PINYIN_OVERRIDES: Record<string, string> = {
  '藏羚': 'zàng líng',
  '藏羚羊': 'zàng líng yáng',
  '小藏羚': 'xiǎo zàng líng',
}

customPinyin(PHRASE_PINYIN_OVERRIDES, { multiple: 'replace', polyphonic: 'replace' })

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
  ei: 'w', un: 'w', vn: 'w', ün: 'w', // vn/ün = j/q/x form of ün
  e: 'e',
  eng: 'r',
  uan: 't', van: 't', üan: 't', // van/üan = j/q/x form of üan
  ong: 'y', iong: 'y',
  ang: 'p',
  a: 's', ia: 's',
  ou: 'd', ie: 'd',
  an: 'f',
  uai: 'g', ing: 'g',
  ai: 'h', ue: 'h', ve: 'h', üe: 'h', // ve/üe = j/q/x form of üe
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

// zh outer finals → Q key as initial; ai/ao/e can also fly to F
const ZH_OUTER_BASE = new Set(['an', 'ang', 'ei', 'en', 'eng', 'u', 'un'])
const ZH_FLY_FINALS = new Set(['ai', 'ao', 'e'])
const ZH_OUTER = new Set([...ZH_OUTER_BASE, ...ZH_FLY_FINALS])
// zh inner finals → F key as initial (uang uses X as final key when zh-inner)
const ZH_INNER = new Set(['a', 'i', 'ong', 'ou', 'ua', 'uai', 'uan', 'uang', 'ui', 'uo'])

// ch outer finals → J key as initial; ao/e can also fly to W
const CH_OUTER_BASE = new Set(['ai', 'an', 'ang', 'en', 'eng', 'u', 'un'])
const CH_FLY_FINALS = new Set(['ao', 'e'])
const CH_OUTER = new Set([...CH_OUTER_BASE, ...CH_FLY_FINALS])
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

// Returns alternative final key for uang (M↔X)
function altFinalKey(initial: string, final: string): string | null {
  if (final !== 'uang') return null
  const primary = getFinalKey(initial, final)
  return primary === 'm' ? 'x' : 'm'
}

// ── Pinyin utils ──────────────────────────────────────────────────────────────

// Strip tone marks → base ASCII pinyin (ü kept as ü)
function normalizePinyin(p: string): string {
  return p
    .replace(/[āáǎà]/g, 'a').replace(/[ēéěè]/g, 'e').replace(/[īíǐì]/g, 'i')
    .replace(/[ōóǒò]/g, 'o').replace(/[ūúǔù]/g, 'u').replace(/[ǖǘǚǜ]/g, 'ü')
    .toLowerCase().replaceAll('v', 'ü').trim()
}

// Ordered longest-first so zh/ch/sh are matched before z/c/s
const INITIALS = ['zh', 'ch', 'sh', 'b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h', 'j', 'q', 'x', 'r', 'z', 'c', 's', 'w', 'y']

export function parsePinyin(p: string): { initial: string; final: string } {
  const norm = normalizePinyin(p)
  if (!norm) return { initial: '', final: '' }
  for (const init of INITIALS) {
    if (norm.startsWith(init)) return { initial: init, final: norm.slice(init.length) }
  }
  return { initial: '', final: norm }
}

export function getPhrasePinyins(word: string): string[] {
  const result = pinyin(word, { type: 'array', toneType: 'symbol' })
  if (!Array.isArray(result)) return []
  return result.map(item => item.trim()).filter(Boolean)
}

// ── Zdic fetching ─────────────────────────────────────────────────────────────

// In-memory cache: char → all pinyin readings (deduped, pinyin-only, no bopomofo)
type FetchTextResult =
  | { status: 'found'; text: string }
  | { status: 'absent' }
  | { status: 'unavailable' }

interface ZdicPinyinLookup {
  status: 'found' | 'absent' | 'unavailable'
  pinyins: string[]
}

const zdicEntryPinyinCache = new Map<string, ZdicPinyinLookup>()
const zdicCharacterPinyinCache = new Map<string, ZdicPinyinLookup>()

// Matches pinyin characters only (no bopomofo ㄅㄆ etc.).
const PINYIN_ONLY_RE = /^[a-züāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]+$/
const PINYIN_VOWEL_RE = /[aeiouüāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/
const SINGLE_PINYIN_LETTER_RE = /^[a-züāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]$/
const PINYIN_TONE_MARK_RE = /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/

function isPinyinSyllable(token: string): boolean {
  return PINYIN_ONLY_RE.test(token)
    && PINYIN_VOWEL_RE.test(token)
    && (!SINGLE_PINYIN_LETTER_RE.test(token) || PINYIN_TONE_MARK_RE.test(token))
}

function splitPinyinText(text: string): string[] {
  return text
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .split(/[、，,\s]+/)
    .map(s => s.trim())
    .filter(isPinyinSyllable)
}

const ZDIC_REQUEST_TIMEOUT_MS = 4000
const ZDIC_RETRY_BACKOFF_MS = 300

function fetchTextAttempt(url: string, redirects: number): Promise<FetchTextResult> {
  return new Promise((resolve) => {
    let settled = false
    const done = (value: FetchTextResult) => {
      if (settled) return
      settled = true
      resolve(value)
    }

    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; keytao-encoder/1.0)' },
    }, (res) => {
      const status = res.statusCode ?? 0
      if (status >= 300 && status < 400 && res.headers.location && redirects > 0) {
        res.resume()
        const nextUrl = new URL(res.headers.location, url).toString()
        fetchTextAttempt(nextUrl, redirects - 1).then(done)
        return
      }

      if (status < 200 || status >= 300) {
        res.resume()
        done(status === 404 || status === 410 ? { status: 'absent' } : { status: 'unavailable' })
        return
      }

      let body = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { body += chunk })
      res.on('end', () => done({ status: 'found', text: body }))
    })
    req.setTimeout(ZDIC_REQUEST_TIMEOUT_MS, () => {
      req.destroy()
      done({ status: 'unavailable' })
    })
    req.on('error', () => done({ status: 'unavailable' }))
  })
}

async function fetchText(url: string, redirects = 2): Promise<FetchTextResult> {
  const first = await fetchTextAttempt(url, redirects)
  if (first.status !== 'unavailable') return first

  await new Promise(resolve => setTimeout(resolve, ZDIC_RETRY_BACKOFF_MS))
  return fetchTextAttempt(url, redirects)
}

async function fetchZdicHtml(entry: string): Promise<FetchTextResult> {
  return fetchText(`https://zdic.net/hans/${encodeURIComponent(entry)}`)
}

async function lookupPinyinsFromZdicEntry(entry: string): Promise<ZdicPinyinLookup> {
  if (zdicEntryPinyinCache.has(entry)) return zdicEntryPinyinCache.get(entry)!
  const cached = await readZdicPinyinCache('entry', entry)
  if (cached && !cached.stale) {
    const result: ZdicPinyinLookup = { status: cached.status, pinyins: cached.pinyins }
    zdicEntryPinyinCache.set(entry, result)
    return result
  }
  const fetched = await fetchZdicHtml(entry)
  if (fetched.status !== 'found') {
    const result: ZdicPinyinLookup = { status: fetched.status, pinyins: [] }
    if (result.status === 'unavailable' && cached?.stale && cached.status === 'absent') {
      return { status: 'absent', pinyins: cached.pinyins }
    }
    if (fetched.status === 'absent') {
      void writeZdicPinyinCache('entry', entry, { status: 'absent', pinyins: result.pinyins })
        .catch(() => undefined)
      zdicEntryPinyinCache.set(entry, result)
    }
    return result
  }

  const metaMatch = fetched.text.match(/<span class="meta-pinyin">([\s\S]*?)<\/span>/)
  const pinyins = metaMatch ? splitPinyinText(metaMatch[1]) : []
  const chars = [...entry]
  const result: ZdicPinyinLookup = pinyins.length === chars.length
    ? { status: 'found', pinyins }
    : { status: 'unavailable', pinyins: [] }
  if (result.status === 'unavailable' && cached?.stale && cached.status === 'absent') {
    return { status: 'absent', pinyins: cached.pinyins }
  }
  if (result.status === 'found') {
    void writeZdicPinyinCache('entry', entry, { status: 'found', pinyins: result.pinyins })
      .catch(() => undefined)
    zdicEntryPinyinCache.set(entry, result)
  }
  return result
}

export async function getPinyinsFromZdicEntry(entry: string): Promise<string[]> {
  return (await lookupPinyinsFromZdicEntry(entry)).pinyins
}

async function getAabbPhrasePinyinsFromZdic(word: string): Promise<ZdicPinyinLookup> {
  const chars = [...word]
  if (chars.length !== 4 || chars[0] !== chars[1] || chars[2] !== chars[3]) {
    return { status: 'absent', pinyins: [] }
  }

  const baseWord = chars[0] + chars[2]
  const base = await lookupPinyinsFromZdicEntry(baseWord)
  return base.status === 'found' && base.pinyins.length === 2
    ? {
        status: 'found',
        pinyins: [base.pinyins[0], base.pinyins[0], base.pinyins[1], base.pinyins[1]],
      }
    : { status: base.status, pinyins: [] }
}

interface PhrasePinyinResolution {
  pinyins: string[]
  trusted: boolean
  trustedIndexes: number[]
  source: 'zdic-phrase' | 'zdic-aabb' | 'pinyin-pro-context' | 'zdic-unavailable'
  standardLookup: StandardPronunciationStatus
}

export interface SemanticPronunciation {
  pinyins: string[]
  meaning: string
}

export interface EncodePhraseOptions {
  semanticPronunciation?: SemanticPronunciation
}

function getTrustedContextPinyinIndexes(word: string, pinyins: string[]): number[] {
  const chars = [...word]
  const lastIndex = chars.length - 1
  if (
    chars.length > 1
    && chars[lastIndex] === '率'
    && normalizePinyin(pinyins[lastIndex] || '') === 'lü'
  ) {
    return [lastIndex]
  }
  return []
}

export async function resolvePhrasePinyins(word: string): Promise<PhrasePinyinResolution> {
  const chars = [...word]
  let standardLookup: PhrasePinyinResolution['standardLookup'] = 'absent'
  if (chars.length > 1) {
    const exact = await lookupPinyinsFromZdicEntry(word)
    if (exact.status === 'found' && exact.pinyins.length === chars.length) {
      return {
        pinyins: exact.pinyins,
        trusted: true,
        trustedIndexes: [],
        source: 'zdic-phrase',
        standardLookup: 'found',
      }
    }
    standardLookup = exact.status

    const aabb = await getAabbPhrasePinyinsFromZdic(word)
    if (aabb.status === 'found' && aabb.pinyins.length === chars.length) {
      return {
        pinyins: aabb.pinyins,
        trusted: true,
        trustedIndexes: [],
        source: 'zdic-aabb',
        standardLookup: 'found',
      }
    }
    if (standardLookup === 'unavailable' || aabb.status === 'unavailable') {
      standardLookup = 'unavailable'
    }
  }

  const pinyins = getPhrasePinyins(word)
  return {
    pinyins,
    trusted: false,
    trustedIndexes: getTrustedContextPinyinIndexes(word, pinyins),
    source: standardLookup === 'unavailable' ? 'zdic-unavailable' : 'pinyin-pro-context',
    standardLookup,
  }
}

async function lookupCharacterPinyinsFromZdic(char: string): Promise<ZdicPinyinLookup> {
  if (zdicCharacterPinyinCache.has(char)) return zdicCharacterPinyinCache.get(char)!
  const cached = await readZdicPinyinCache('char', char)
  if (cached && !cached.stale) {
    const result: ZdicPinyinLookup = { status: cached.status, pinyins: cached.pinyins }
    zdicCharacterPinyinCache.set(char, result)
    return result
  }

  const staleAbsent = (): ZdicPinyinLookup | null => {
    if (!cached?.stale || cached.status !== 'absent') return null
    return { status: 'absent', pinyins: cached.pinyins }
  }

  try {
    const fetched = await fetchZdicHtml(char)
    if (fetched.status !== 'found') {
      const result: ZdicPinyinLookup = { status: fetched.status, pinyins: [] }
      if (fetched.status === 'unavailable') return staleAbsent() ?? result
      void writeZdicPinyinCache('char', char, { status: 'absent', pinyins: result.pinyins })
        .catch(() => undefined)
      zdicCharacterPinyinCache.set(char, result)
      return result
    }
    const html = fetched.text
    // Extract all <span class="z_d song">…</span> values, keep only pinyin (not bopomofo)
    const all = [...html.matchAll(/class="z_d song">([^<\s]+)/g)]
      .map(m => m[1])
      .filter(isPinyinSyllable)
    const deduped = [...new Set(all)]
    if (deduped.length > 0) {
      const result: ZdicPinyinLookup = { status: 'found', pinyins: deduped }
      void writeZdicPinyinCache('char', char, { status: 'found', pinyins: result.pinyins })
        .catch(() => undefined)
      zdicCharacterPinyinCache.set(char, result)
      return result
    }
    // Fallback: parse pinyin from page title (format: "{char} pȳ1、pȳ2 - 汉典")
    // TONED_PINYIN_RE fails on syllables like guì/jué where the tone mark isn't first after the initial
    const titleMatch = html.match(/<title>[^\s<]+\s+([^<]+?)\s*-\s*汉典<\/title>/)
    if (titleMatch) {
      const titlePinyins = titleMatch[1].split(/[、，,\s]+/).filter(isPinyinSyllable)
      if (titlePinyins.length > 0) {
        const result: ZdicPinyinLookup = { status: 'found', pinyins: titlePinyins }
        void writeZdicPinyinCache('char', char, { status: 'found', pinyins: result.pinyins })
          .catch(() => undefined)
        zdicCharacterPinyinCache.set(char, result)
        return result
      }
    }
    return staleAbsent() ?? { status: 'unavailable', pinyins: [] }
  } catch {
    return staleAbsent() ?? { status: 'unavailable', pinyins: [] }
  }
}

export async function getPinyinFromZdic(char: string): Promise<string[]> {
  return (await lookupCharacterPinyinsFromZdic(char)).pinyins
}

// ── Single character encoding ─────────────────────────────────────────────────

export interface CharEncoding {
  char: string
  pinyin: string          // first (default) reading used for encoding
  pinyins: string[]       // all readings from zdic (may be multiple for polyphonic chars)
  pronunciationLookupStatus?: StandardPronunciationStatus
  phoneticCode: string   // 2-key: initial+final
  c1: string | null      // raw c1 radicals from split
  c2: string | null      // raw c2 radicals from split
  shapeCode: string | null // full shape code (c1code+c2code)
  fullCode: string       // phoneticCode + shapeCode
}

export type FlyKeyRule = 'zh-outer' | 'zh-inner' | 'ch-outer' | 'ch-inner' | 'uang-final'

export interface FlyKeyChange {
  index: number
  char: string
  pinyin: string
  fromKey: string
  toKey: string
  rule: FlyKeyRule
  kind: 'initial' | 'final'
}

export interface FlyKeyVariant {
  baseCode: string
  codes: string[]
  changes: FlyKeyChange[]
}

export interface RequestedCodeAnalysis {
  code: string
  supported: boolean
  matchType: 'standard' | 'flyKey' | 'sameSeries' | 'unsupported'
  message: string
  matchedCode?: string
  seriesBase?: string
  seriesCodes?: string[]
  changes?: FlyKeyChange[]
  alternatives: string[]
}

interface EncodeCharOptions {
  trustPreferred?: boolean
  requireKnownPreferred?: boolean
}

export async function encodeChar(char: string, preferredPinyin?: string, options: EncodeCharOptions = {}): Promise<CharEncoding> {
  const pronunciationLookup = await lookupCharacterPinyinsFromZdic(char)
  const zdicPinyins = pronunciationLookup.pinyins
  // Word-level zdic readings are trusted when they still exist in the character's reading list.
  // Otherwise, pinyin-pro context is used only when its standalone reading agrees with zdic's
  // primary reading; this keeps rare chars like 鳜 from being pulled to pinyin-pro's jué default.
  let pinyins: string[]
  if (zdicPinyins.length > 0) {
    const normZdic = new Set(zdicPinyins.map(normalizePinyin))
    const trustedPreferred = preferredPinyin && normZdic.has(normalizePinyin(preferredPinyin)) ? [preferredPinyin] : []
    if (options.trustPreferred && trustedPreferred.length > 0) {
      pinyins = [...new Set([...trustedPreferred, ...zdicPinyins])]
    } else {
      const [standalone] = getPhrasePinyins(char)
      const pinyinProReliable = standalone && normalizePinyin(standalone) === normalizePinyin(zdicPinyins[0])
      if (pinyinProReliable) {
        const preferred = preferredPinyin && normZdic.has(normalizePinyin(preferredPinyin)) ? [preferredPinyin] : []
        pinyins = [...new Set([...preferred, ...zdicPinyins])]
      } else {
        pinyins = zdicPinyins
      }
    }
  } else if (!options.requireKnownPreferred) {
    pinyins = preferredPinyin ? [preferredPinyin] : []
  } else {
    pinyins = []
  }
  const pinyinStr = pinyins[0] ?? ''
  const { initial, final } = parsePinyin(pinyinStr)
  const phoneticCode = encodePhonetic(initial, final)
  const shape = encodeShape(char)
  return {
    char,
    pinyin: pinyinStr,
    pinyins,
    pronunciationLookupStatus: pronunciationLookup.status,
    phoneticCode,
    c1: shape?.c1 ?? null,
    c2: shape?.c2 ?? null,
    shapeCode: shape?.code ?? null,
    fullCode: phoneticCode + (shape?.code ?? ''),
  }
}

// ── Phrase encoding ───────────────────────────────────────────────────────────

export type PhraseType = '单字' | '二字词' | '三字词' | '四字词及以上'

export type PronunciationSource =
  | 'zdic-phrase'
  | 'zdic-aabb'
  | 'zdic-character-default'
  | 'pinyin-pro-context'
  | 'zdic-unavailable'
  | 'llm-semantic'

export type StandardPronunciationStatus = 'found' | 'absent' | 'unavailable'

export interface PhraseEncoding {
  input: string
  type: PhraseType
  chars: CharEncoding[]
  // Progressive codes: index 0 = base (minimum keys), each subsequent adds one shape disambiguation key
  codes: string[]
  // 飞键 variants for base code (zh/ch/uang alt positions)
  altCodes: string[]
  // Grouped fly-key series. Each series contains its own progressive shape codes.
  flyKeyVariants: FlyKeyVariant[]
  // Source of the pronunciation actually selected for encoding.
  pronunciationSource?: PronunciationSource
  // Result of the authoritative whole-word lookup. Kept separate from the
  // selected source because an accepted semantic reading may be used after an
  // unavailable lookup.
  standardPronunciationStatus?: StandardPronunciationStatus
  phrasePinyins?: string[]
  contextPhrasePinyins?: string[]
  semanticPronunciationNeeded?: boolean
  semanticPronunciationAccepted?: boolean
}

function firstShapeKey(enc: CharEncoding): string {
  return enc.shapeCode?.[0] ?? ''
}

function buildCodes(base: string, shapeSteps: string[], type: 'Single' | 'Phrase'): string[] {
  const codes = [base]
  let current = base
  for (const s of shapeSteps) {
    if (!s) break
    const next = appendCodeWithinMaxLength(current, s, type)
    if (!next) {
      console.warn('[keytaoEncoder] Dropped over-length generated code', {
        code: current + s,
        type,
      })
      break
    }
    current = next
    codes.push(current)
  }
  return codes
}

interface KeyChoice {
  initKey: string
  finKey: string
  change: FlyKeyChange | null
}

function initialFlyChoice(char: CharEncoding, info: { initial: string; final: string }, index: number): KeyChoice | null {
  const initKey = char.phoneticCode[0] ?? ''
  const finKey = char.phoneticCode[1] ?? ''
  if (info.initial === 'zh' && ZH_FLY_FINALS.has(info.final) && initKey === 'q') {
    return {
      initKey: 'f',
      finKey,
      change: { index, char: char.char, pinyin: char.pinyin, fromKey: 'q', toKey: 'f', rule: 'zh-inner', kind: 'initial' },
    }
  }
  if (info.initial === 'ch' && CH_FLY_FINALS.has(info.final) && initKey === 'j') {
    return {
      initKey: 'w',
      finKey,
      change: { index, char: char.char, pinyin: char.pinyin, fromKey: 'j', toKey: 'w', rule: 'ch-inner', kind: 'initial' },
    }
  }
  return null
}

function finalFlyChoice(char: CharEncoding, info: { initial: string; final: string }, index: number): KeyChoice | null {
  const initKey = char.phoneticCode[0] ?? ''
  const finKey = char.phoneticCode[1] ?? ''
  const altFin = altFinalKey(info.initial, info.final)
  if (!altFin) return null
  return {
    initKey,
    finKey: altFin,
    change: { index, char: char.char, pinyin: char.pinyin, fromKey: finKey, toKey: altFin, rule: 'uang-final', kind: 'final' },
  }
}

function phraseCodePositions(length: number): number[] {
  if (length <= 3) return Array.from({ length }, (_, index) => index)
  return [0, 1, 2, length - 1]
}

function buildBaseFromChoices(length: number, choices: KeyChoice[]): string {
  if (length <= 2) return choices.map(choice => choice.initKey + choice.finKey).join('')
  return choices.map(choice => choice.initKey).join('')
}

function buildFlyKeyVariants(
  chars: CharEncoding[],
  pinyinInfos: Array<{ initial: string; final: string }>,
  base: string,
  shapeSteps: string[],
  codeType: 'Single' | 'Phrase'
): FlyKeyVariant[] {
  const positions = phraseCodePositions(chars.length)
  const choicesByPosition = positions.map((charIndex) => {
    const char = chars[charIndex]
    const info = pinyinInfos[charIndex]
    const primary: KeyChoice = {
      initKey: char.phoneticCode[0] ?? '',
      finKey: char.phoneticCode[1] ?? '',
      change: null,
    }
    const choices = [primary]
    const initChoice = initialFlyChoice(char, info, charIndex)
    if (initChoice) choices.push(initChoice)
    if (chars.length <= 2) {
      const finChoice = finalFlyChoice(char, info, charIndex)
      if (finChoice) choices.push(finChoice)
    }
    return choices
  })

  const variants: FlyKeyVariant[] = []
  const walk = (positionIndex: number, selected: KeyChoice[]) => {
    if (positionIndex >= choicesByPosition.length) {
      const changes = selected.map(choice => choice.change).filter((change): change is FlyKeyChange => change !== null)
      if (changes.length === 0) return
      const altBase = buildBaseFromChoices(chars.length, selected)
      if (altBase === base) return
      variants.push({ baseCode: altBase, codes: buildCodes(altBase, shapeSteps, codeType), changes })
      return
    }
    for (const choice of choicesByPosition[positionIndex]) {
      walk(positionIndex + 1, [...selected, choice])
    }
  }

  walk(0, [])

  const unique = new Map<string, FlyKeyVariant>()
  for (const variant of variants) {
    if (!unique.has(variant.baseCode)) unique.set(variant.baseCode, variant)
  }

  return [...unique.values()].sort((a, b) => {
    const changeCount = a.changes.length - b.changes.length
    if (changeCount !== 0) return changeCount
    const firstIndex = a.changes[0].index - b.changes[0].index
    if (firstIndex !== 0) return firstIndex
    return a.baseCode.localeCompare(b.baseCode)
  })
}

export function analyzeRequestedCode(encoding: PhraseEncoding, requestedCode: string): RequestedCodeAnalysis {
  const code = requestedCode.trim().toLowerCase()
  const alternatives = [...new Set([...encoding.codes, ...encoding.altCodes])]

  if (!code) {
    return { code, supported: false, matchType: 'unsupported', message: '未提供目标编码', alternatives }
  }

  if (encoding.semanticPronunciationNeeded) {
    return {
      code,
      supported: false,
      matchType: 'unsupported',
      message: '读音存在歧义，当前编码不能作为已验证候选',
      alternatives: [],
    }
  }

  if (encoding.pronunciationSource === 'zdic-unavailable') {
    return {
      code,
      supported: false,
      matchType: 'unsupported',
      message: '权威读音服务暂不可用，无法验证当前编码',
      alternatives: [],
    }
  }

  if (encoding.codes.includes(code)) {
    return { code, supported: true, matchType: 'standard', matchedCode: code, seriesBase: encoding.codes[0], seriesCodes: encoding.codes, message: `${code} 是标准候选编码`, alternatives }
  }

  const exactFly = encoding.flyKeyVariants.find(variant => variant.codes.includes(code))
  if (exactFly) {
    return {
      code,
      supported: true,
      matchType: 'flyKey',
      matchedCode: code,
      seriesBase: exactFly.baseCode,
      seriesCodes: exactFly.codes,
      changes: exactFly.changes,
      message: `${code} 是固定飞键候选编码`,
      alternatives,
    }
  }

  const sameSeries = encoding.flyKeyVariants.find(variant => code.startsWith(variant.baseCode) || variant.codes.some(candidate => candidate.startsWith(code)))
  if (sameSeries) {
    return {
      code,
      supported: false,
      matchType: 'sameSeries',
      seriesBase: sameSeries.baseCode,
      seriesCodes: sameSeries.codes,
      changes: sameSeries.changes,
      message: `${code} 属于 ${sameSeries.baseCode} 系列，但不是当前规则生成的候选码`,
      alternatives,
    }
  }

  return { code, supported: false, matchType: 'unsupported', message: `${code} 不在当前固定飞键规则生成的候选中`, alternatives }
}

export function buildPhraseEncodingFromChars(word: string, chars: CharEncoding[]): PhraseEncoding {
  const pinyinInfos = chars.map((c) => parsePinyin(c.pinyin))

  const n = chars.length
  let type: PhraseType
  let base: string
  let shapeSteps: string[]

  if (n === 1) {
    type = '单字'
    base = chars[0].phoneticCode
    const shape = chars[0].shapeCode ?? ''
    shapeSteps = shape.split('')
  } else if (n === 2) {
    type = '二字词'
    base = chars[0].phoneticCode + chars[1].phoneticCode
    shapeSteps = [firstShapeKey(chars[0]), firstShapeKey(chars[1])]
  } else if (n === 3) {
    type = '三字词'
    base = pinyinInfos.map((_, i) => chars[i].phoneticCode[0] ?? '').join('')
    shapeSteps = chars.map(firstShapeKey)
  } else {
    type = '四字词及以上'
    const initials = [0, 1, 2, n - 1].map((i) => chars[i].phoneticCode[0] ?? '')
    base = initials.join('')
    shapeSteps = [firstShapeKey(chars[0]), firstShapeKey(chars[1])]
  }

  const codeType = n === 1 ? 'Single' : 'Phrase'
  const codes = buildCodes(base, shapeSteps, codeType)
  const flyKeyVariants = buildFlyKeyVariants(chars, pinyinInfos, base, shapeSteps, codeType)
  const altCodes = [...new Set(flyKeyVariants.flatMap(variant => variant.codes))]

  return { input: word, type, chars, codes, altCodes, flyKeyVariants }
}

export async function encodePhrase(word: string, options: EncodePhraseOptions = {}): Promise<PhraseEncoding> {
  const {
    pinyins: phrasePinyins,
    trusted,
    trustedIndexes,
    source,
    standardLookup,
  } = await resolvePhrasePinyins(word)
  const trustedIndexSet = new Set(trustedIndexes)
  const wordChars = [...word]
  const semantic = options.semanticPronunciation

  const encodeChars = (preferred: string[], trustSemantic: boolean) => Promise.all(
    wordChars.map((char, index) => encodeChar(char, preferred[index], {
      trustPreferred: trusted || trustedIndexSet.has(index) || trustSemantic,
      requireKnownPreferred: trustSemantic,
    }))
  )

  const baselineChars = await encodeChars(phrasePinyins, false)
  const baselineMatchesContext = baselineChars.every(
    (char, index) => normalizePinyin(char.pinyin) === normalizePinyin(phrasePinyins[index] || '')
  )
  const baselineReadingsVerified = baselineChars.every(
    char => char.pronunciationLookupStatus === 'found'
  )
  const semanticPronunciationNeeded = Boolean(
    !trusted
    && standardLookup !== 'found'
    && wordChars.length > 1
    && !baselineMatchesContext
  )
  const semanticPinyins = (
    semanticPronunciationNeeded
    && semantic
    && [...semantic.meaning.trim()].length >= 4
    && semantic.pinyins.length === wordChars.length
    && semantic.pinyins.every((item, index) => {
      const normalized = normalizePinyin(item)
      return Boolean(normalized)
        && normalized === normalizePinyin(phrasePinyins[index] || '')
    })
  ) ? semantic.pinyins.map(item => item.trim()) : []

  let chars = baselineChars
  let semanticPronunciationAccepted = false
  if (semanticPinyins.length) {
    const semanticChars = await encodeChars(semanticPinyins, true)
    semanticPronunciationAccepted = semanticChars.every(
      (char, index) => normalizePinyin(char.pinyin) === normalizePinyin(semanticPinyins[index])
    )
    if (semanticPronunciationAccepted) chars = semanticChars
  }

  const pronunciationSource: PronunciationSource = semanticPronunciationAccepted
    ? 'llm-semantic'
    : trusted
      ? source as 'zdic-phrase' | 'zdic-aabb'
      : baselineMatchesContext && baselineReadingsVerified
        ? 'pinyin-pro-context'
        : standardLookup === 'unavailable' || !baselineReadingsVerified
          ? 'zdic-unavailable'
          : 'zdic-character-default'

  return {
    ...buildPhraseEncodingFromChars(word, chars),
    pronunciationSource,
    standardPronunciationStatus: standardLookup,
    phrasePinyins: chars.map(char => char.pinyin),
    contextPhrasePinyins: phrasePinyins,
    semanticPronunciationNeeded: semanticPronunciationNeeded && !semanticPronunciationAccepted,
    semanticPronunciationAccepted,
  }
}
