'use client'

import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState, type Key } from 'react'
import Link from 'next/link'
import JSZip from 'jszip'
import { pinyin } from 'pinyin-pro'
import {
  Alert,
  Button,
  Card,
  CardBody,
  Chip,
  Progress,
  Select,
  SelectItem,
  Spinner,
  Switch,
  Textarea,
  Tooltip,
} from '@heroui/react'
import {
  AlertTriangle,
  Coffee,
  Download,
  Eye,
  EyeOff,
  FileText,
  Info,
  Keyboard,
  Layers,
  RotateCcw,
  Shuffle,
  SkipForward,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react'
import {
  createLibrimeWasmEngine,
  getRimeKeyFromKeyboardEvent,
  type LibrimeWasmEngine,
  type LibrimeWasmStatus,
  type RimeComposition,
  type RimeDeployFile,
  type RimeProcessResult,
  type RimeSchema,
} from '@/lib/librime-wasm'
import {
  buildPracticeDictionary,
  createPracticeItemsFromText,
  parseRimeDictContent,
  type PracticeDictionary,
  type PracticeEntry,
} from '@/lib/services/keytaoPracticeDictionary'
import { resolveFollowPracticeCommit, resolvePracticeCommit, splitFollowRemainingTexts, type FollowCurrentItemSegment } from '@/lib/services/practiceCommitFlow'
import {
  deleteCachedPracticeSchemeZip,
  getCachedPracticeSchemeZip,
  putCachedPracticeSchemeZip,
  type CachedPracticeSchemeVersion,
} from '@/lib/services/practiceSchemeCache'
import { DEFAULT_PRACTICE_ARTICLE_OPTIONS, type PracticeArticleOption } from '@/lib/services/practiceArticles'
import { usePracticeStore, type PracticeSchemeKey } from '@/lib/store/practice'
import { KEYTAO_FLY_KEY_CHARACTERS } from '@/lib/data/keytaoFlyKeyPractice'

const DEFAULT_PRACTICE_TEXT = '我们可以通过键道练习输入文字词组编码方案系统开源词库用户学习效率中文输入法'
const MAX_CUSTOM_TEXT_BYTES = 256 * 1024
const MAX_DISPLAYED_CANDIDATES = 6
const EMPTY_RIME_CANDIDATES: RimeComposition['candidates'] = []
const PRACTICE_ARTICLES_CACHE_KEY = 'keytao-practice-articles:v1'
const KEYTAO_CONFIG_CACHE_KEY = 'keytao-practice-config:v1'
const COMMON_SINGLE_CHARACTER_ORDER = '的一是在不了有和人这中大为上个国我以要他时来用们生到作地于出就分对成会可主发年动同工也能下过子说产种面而方后多定行学法所民得经十三之进着等部度家电力里如水化高自二理起小物现实加量都两体制机当使点从业本去把性好应开它合还因由其些然前外天政四日那社义事平形相全表间样与关各重新线内数正心反你明看原又么利比或但质气第向道命此变条只没结解问意建月公无系军很情者最立代想已通并提直题党程展五果料象员革位入常文总次品式活设及管特件长求老头基资边流路级少图山统接知较将组见计别她手角期根论运农指几九区强放决西被干做必战先回则任取据处队南给色光门即保治北造百规热领七海口东导器压志世金增争济阶油思术极交受联什认六共权收证改清己美再采转更单风切打白教速花带安场身车例真务具万每目至达走积示议声报斗完类八离华名确才科张信马节话米整空元况今集温传土许步群广石记需段研界拉林律叫且究观越织装影算低持音众书布复容儿须际商非验连断深难近矿千周委素技备半办青省列习响约支般史感劳便团往酸历市克何除消构府称太准精值号率族维划选标写存候毛亲快效斯院查江型眼王按格养易置派层片始却专状育厂京识适属圆包火住调满县局照参红细引听该铁价严龙飞'
const COMMON_CHARACTER_RANK = new Map(Array.from(COMMON_SINGLE_CHARACTER_ORDER).map((char, index) => [char, index]))

type SchemeStatus = 'idle' | 'loading' | 'ready' | 'error'
type PracticeSource = 'common500' | 'common1000' | 'article' | 'custom' | 'flyKey' | 'keytao630'
type PracticeMode = 'follow' | 'study'
type FlyKeyRuleId = 'zh-outer' | 'zh-inner' | 'ch-outer' | 'ch-inner' | 'uang-m' | 'uang-x'

interface KeyTaoConfigData {
  rootMap: Record<string, string>
  splitMap: Record<string, { c1: string; c2: string }>
}

interface FlyKeyHint {
  id: FlyKeyRuleId
  label: string
  key: string
  reason: string
}

interface CharacterInsight {
  char: string
  pinyin: string
  phoneticCode: string
  split?: { c1: string; c2: string }
  shapeCode?: string
  codes: string[]
  flyHints: FlyKeyHint[]
}

interface PracticeInsight {
  text: string
  codes: string[]
  characters: CharacterInsight[]
}

interface PracticeSchemeReleaseInfo {
  scheme: PracticeSchemeKey
  label: string
  version: string
  downloadUrl: string
  assetName: string
}

const PRACTICE_SCHEME_OPTIONS: Array<{ key: PracticeSchemeKey; label: string; asset: string }> = [
  { key: 'keytao', label: '键道6', asset: 'keytao-linux' },
  { key: 'xmjd', label: '星猫键道', asset: 'xmjd6.zip' },
  { key: 'txjx', label: '天行键', asset: 'txjx.zip' },
  { key: 'keydo', label: '键道·我流', asset: 'nightly zip' },
]

function isPracticeSchemeKey(value: string | null): value is PracticeSchemeKey {
  return value === 'keytao' || value === 'xmjd' || value === 'txjx' || value === 'keydo'
}

function getSingleSelectionValue(keys: 'all' | Set<Key>) {
  const [firstKey] = Array.from(keys)
  if (typeof firstKey === 'string') return firstKey
  if (typeof firstKey === 'number') return String(firstKey)
  return null
}

const KEYTAO_630_TEXT = `不能 班级 不了 宝贝 不好 不敢 不但 不见 别人 不错 不少 不会 不是 不让 便是 表情 不断 毕竟 必须 不用 别的 爸爸 变得 不知 不过 不到 不想 本来 变成 不禁
才能 曾经 村子 沧桑 参加 村民 操作 村里 此人 催促 从小 从此 此时 测试 才是 匆忙 从前 此刻 采用 匆匆 苍白 苍老 厕所 村长 存在 参与 从事 从来 才有 从未
到了 大约 肚子 都能 打架 当即 多少 当中 大人 短信 动作 地上 但是 的话 都是 大家 弟弟 地方 当然 多么 独自 大爷 等待 打算 东西 得到 底下 大哥 对面 对于
生活 视线 身子 深深 身边 手臂 时候 世界 是从 时光 双手 身上 时间 说话 瞬间 事情 说着 声音 什么 舒服 似的 十分 身后 少年 上面 甚至 剩下 上来 手机 属于
只能 纷纷 房子 否则 只好 发展 这个 这里 这种 这样 方向 分钟 发现 这个 这里 这种 这样`

const PRACTICE_SOURCE_OPTIONS: Array<{ key: PracticeSource; label: string; detail: string }> = [
  { key: 'common500', label: '单字常用字前500', detail: '高频单字' },
  { key: 'common1000', label: '单字常用字前1000', detail: '扩展高频' },
  { key: 'keytao630', label: '键道630练习', detail: '高频词组' },
  { key: 'article', label: '文章', detail: '下拉选择' },
  { key: 'flyKey', label: '键道飞键练习', detail: '常用飞键500' },
  { key: 'custom', label: '自定义文本', detail: '上传或粘贴' },
]

const FLY_RULE_SUMMARY = [
  { id: 'zh-outer', keyName: 'Q', head: 'zh 外', finals: 'an / ang / ei / en / eng / u / un', fly: 'ai / ao / e 可飞 F' },
  { id: 'zh-inner', keyName: 'F', head: 'zh 内', finals: 'a / i / ong / ou / ua / uai / uan / uang / ui / uo', fly: '' },
  { id: 'ch-outer', keyName: 'J', head: 'ch 外', finals: 'ai / an / ang / en / eng / u / un', fly: 'ao / e 可飞 W' },
  { id: 'ch-inner', keyName: 'W', head: 'ch 内', finals: 'a / i / ong / ou / ua / uai / uan / uang / ui / uo', fly: '' },
  { id: 'uang-m', keyName: 'M', head: 'uang', finals: '非 zh 内 / ch 内声母后', fly: '' },
  { id: 'uang-x', keyName: 'X', head: 'uang', finals: 'zh 内(F) / ch 内(W)声母后', fly: '' },
]

const KEYBOARD_ROWS = [
  [
    { keyName: 'Q', initial: 'zh', finals: ['iu', 'ua'], tone: 'outer' },
    { keyName: 'W', initial: 'ch', finals: ['ei', 'un'], tone: 'outer' },
    { keyName: 'E', initial: 'sh', finals: ['e'], tone: 'outer' },
    { keyName: 'R', finals: ['eng'], tone: 'outer' },
    { keyName: 'T', finals: ['uan'], tone: 'outer' },
    { keyName: 'Y', finals: ['iong', 'ong'], tone: 'outer' },
    { keyName: 'U', roots: ['月', '十o'], tone: 'special', rootKey: '丿' },
    { keyName: 'I', roots: ['人', '手u', '草i', '金o'], tone: 'special', rootKey: '丨' },
    { keyName: 'O', roots: ['口', '日i'], tone: 'special', rootKey: '丶' },
    { keyName: 'P', finals: ['ang'], tone: 'outer' },
  ],
  [
    { keyName: 'A', roots: ['水', '贝o'], tone: 'special', rootKey: '乙' },
    { keyName: 'S', finals: ['a', 'ia'], tone: 'outer' },
    { keyName: 'D', finals: ['ie', 'ou'], tone: 'outer' },
    { keyName: 'F', initial: 'zh', finals: ['an'], tone: 'outer' },
    { keyName: 'G', finals: ['ing', 'uai'], tone: 'outer' },
    { keyName: 'H', finals: ['ai', 'üe'], tone: 'outer' },
    { keyName: 'J', initial: 'ch', finals: ['er', 'u'], tone: 'outer' },
    { keyName: 'K', finals: ['i'], tone: 'outer' },
    { keyName: 'L', finals: ['o', 'uo', 'ü'], tone: 'outer' },
    { keyName: ';', finals: [], tone: 'outer' },
  ],
  [
    { keyName: 'Z', finals: ['ao'], tone: 'outer' },
    { keyName: 'X', finals: ['iang', 'uang'], tone: 'outer', rootKey: '~' },
    { keyName: 'C', finals: ['iao'], tone: 'outer' },
    { keyName: 'V', roots: ['木', '土o', '土o'], tone: 'special', rootKey: '一' },
    { keyName: 'B', finals: ['in', 'ui'], tone: 'outer' },
    { keyName: 'N', finals: ['en'], tone: 'outer' },
    { keyName: 'M', finals: ['ian', 'uang'], tone: 'outer' },
    { keyName: ',', finals: [], tone: 'outer' },
    { keyName: '.', finals: [], tone: 'outer' },
    { keyName: '/', finals: ['键道6'], tone: 'brand' },
  ],
]

type KeydoGraphTone = 'regular'

interface KeydoGraphCell {
  keyName: string
  phonetic?: string
  rootKey?: string
  cornerLabel?: string
  bodyRows?: string[][]
  tone: KeydoGraphTone
}

const KEYDO_GRAPH_ROWS: KeydoGraphCell[][] = [
  [
    { keyName: 'Q', phonetic: 'zh', bodyRows: [['iu', 'ua']], tone: 'regular' },
    { keyName: 'W', phonetic: 'ch', bodyRows: [['ei', 'un']], tone: 'regular' },
    { keyName: 'F', phonetic: 'zh', bodyRows: [['an']], tone: 'regular' },
    { keyName: 'P', bodyRows: [['ang']], tone: 'regular' },
    { keyName: 'B', bodyRows: [['in', 'ui']], tone: 'regular' },
    { keyName: 'J', phonetic: 'ch', bodyRows: [['er', 'u']], tone: 'regular' },
    { keyName: 'L', bodyRows: [['o', 'uo', 'ü']], tone: 'regular' },
    { keyName: 'U', rootKey: '丿', cornerLabel: '月', bodyRows: [['十 o']], tone: 'regular' },
    { keyName: 'Y', bodyRows: [['iong', 'ong']], tone: 'regular' },
    { keyName: ';', bodyRows: [['引导']], tone: 'regular' },
  ],
  [
    { keyName: 'A', rootKey: '𠃌', cornerLabel: '氵', bodyRows: [['贝 o']], tone: 'regular' },
    { keyName: 'R', bodyRows: [['eng']], tone: 'regular' },
    { keyName: 'S', bodyRows: [['a', 'ia']], tone: 'regular' },
    { keyName: 'T', bodyRows: [['uan']], tone: 'regular' },
    { keyName: 'G', bodyRows: [['ing', 'uai']], tone: 'regular' },
    { keyName: 'M', bodyRows: [['ian', 'uang']], tone: 'regular' },
    { keyName: 'N', bodyRows: [['en']], tone: 'regular' },
    { keyName: 'E', phonetic: 'sh', bodyRows: [['e']], tone: 'regular' },
    { keyName: 'I', rootKey: '丨', cornerLabel: '亻', bodyRows: [['艹i'], ['钅o', '扌u']], tone: 'regular' },
    { keyName: 'O', rootKey: '丶', cornerLabel: '口', bodyRows: [['日 i']], tone: 'regular' },
  ],
  [
    { keyName: 'Z', bodyRows: [['ao']], tone: 'regular' },
    { keyName: 'X', rootKey: '~', bodyRows: [['iang', 'uang']], tone: 'regular' },
    { keyName: 'C', bodyRows: [['iao']], tone: 'regular' },
    { keyName: 'D', bodyRows: [['ie', 'ou']], tone: 'regular' },
    { keyName: 'V', rootKey: '一', cornerLabel: '木', bodyRows: [['土 o']], tone: 'regular' },
    { keyName: 'K', bodyRows: [['i']], tone: 'regular' },
    { keyName: 'H', bodyRows: [['ai', 'üe']], tone: 'regular' },
    { keyName: ',', tone: 'regular' },
    { keyName: '.', tone: 'regular' },
    { keyName: '/', bodyRows: [['重复'], ['键道·我流']], tone: 'regular' },
  ],
]

const ZH_OUTER_BASE = new Set(['an', 'ang', 'ei', 'en', 'eng', 'u', 'un'])
const ZH_FLY_FINALS = new Set(['ai', 'ao', 'e'])
const ZH_INNER = new Set(['a', 'i', 'ong', 'ou', 'ua', 'uai', 'uan', 'uang', 'ui', 'uo'])
const CH_OUTER_BASE = new Set(['ai', 'an', 'ang', 'en', 'eng', 'u', 'un'])
const CH_FLY_FINALS = new Set(['ao', 'e'])
const CH_INNER = new Set(['a', 'i', 'ong', 'ou', 'ua', 'uai', 'uan', 'uang', 'ui', 'uo'])

const FINAL_KEY: Record<string, string> = {
  ua: 'q', iu: 'q', ei: 'w', un: 'w', vn: 'w', ün: 'w', e: 'e', eng: 'r',
  uan: 't', van: 't', üan: 't', ong: 'y', iong: 'y', ang: 'p', a: 's', ia: 's',
  ou: 'd', ie: 'd', an: 'f', uai: 'g', ing: 'g', ai: 'h', ue: 'h', ve: 'h', üe: 'h',
  u: 'j', er: 'j', i: 'k', uo: 'l', v: 'l', o: 'l', ü: 'l', in: 'b', ui: 'b',
  en: 'n', ian: 'm', iang: 'x', iao: 'c', ao: 'z',
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0')
  const seconds = (totalSeconds % 60).toString().padStart(2, '0')
  return `${minutes}:${seconds}`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function getCandidateLabel(index: number): string {
  return index === 9 ? '0' : `${index + 1}`
}

function getTextLength(text: string): number {
  return Array.from(text).length
}

function getTextByteSize(text: string): number {
  return new Blob([text]).size
}

function renderFixedWidthText(text: string, keyPrefix: string) {
  return Array.from(text).map((char, index) => {
    if (char === '\n') return <br key={`${keyPrefix}-br-${index}`} />

    return (
      <span key={`${keyPrefix}-char-${index}`} className="inline-block w-[1em] text-center align-baseline">
        {char === ' ' ? '\u00A0' : char}
      </span>
    )
  })
}

function isBrowserOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

function readLocalJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : null
  } catch {
    return null
  }
}

function writeLocalJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Local persistence is an offline convenience; quota/private-mode failures should not block practice.
  }
}

function readCachedPracticeArticles(): PracticeArticleOption[] | null {
  const cached = readLocalJson<{ articles?: PracticeArticleOption[] }>(PRACTICE_ARTICLES_CACHE_KEY)
  return cached?.articles && cached.articles.length > 0 ? cached.articles : null
}

function writeCachedPracticeArticles(articles: PracticeArticleOption[]) {
  writeLocalJson(PRACTICE_ARTICLES_CACHE_KEY, {
    articles,
    cachedAt: new Date().toISOString(),
  })
}

function readCachedKeyTaoConfig(): KeyTaoConfigData | null {
  return readLocalJson<KeyTaoConfigData>(KEYTAO_CONFIG_CACHE_KEY)
}

function writeCachedKeyTaoConfig(config: KeyTaoConfigData) {
  writeLocalJson(KEYTAO_CONFIG_CACHE_KEY, {
    rootMap: config.rootMap,
    splitMap: config.splitMap,
  })
}

function shufflePracticeItems<T>(items: T[]): T[] {
  const nextItems = [...items]

  for (let index = nextItems.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
      ;[nextItems[index], nextItems[swapIndex]] = [nextItems[swapIndex], nextItems[index]]
  }

  return nextItems
}

function findAutoCommitCandidateIndex(
  composition: RimeComposition | null | undefined,
  currentCommittedText: string,
  currentTargetText: string | undefined,
  targetCodes: string[]
): number {
  if (!composition || !currentTargetText) return -1

  const preedit = composition.preedit.trim().toLowerCase()
  const normalizedTargetCodes = targetCodes.map((code) => code.trim().toLowerCase())
  if (!preedit || !normalizedTargetCodes.some((code) => code === preedit)) return -1

  return composition.candidates.findIndex((candidate) => `${currentCommittedText}${candidate.text}` === currentTargetText)
}

function normalizePinyin(value: string): string {
  return value
    .replace(/[āáǎà]/g, 'a').replace(/[ēéěè]/g, 'e').replace(/[īíǐì]/g, 'i')
    .replace(/[ōóǒò]/g, 'o').replace(/[ūúǔù]/g, 'u').replace(/[ǖǘǚǜ]/g, 'ü')
    .toLowerCase().trim()
}

const INITIALS = ['zh', 'ch', 'sh', 'b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h', 'j', 'q', 'x', 'r', 'z', 'c', 's', 'w', 'y']

function parsePinyinSyllable(value: string): { initial: string; final: string } {
  const normalized = normalizePinyin(value)
  for (const initial of INITIALS) {
    if (normalized.startsWith(initial)) return { initial, final: normalized.slice(initial.length) }
  }
  return { initial: '', final: normalized }
}

function getFinalKey(initial: string, final: string): string {
  if (final === 'uang') return initial === 'zh' || initial === 'ch' ? 'x' : 'm'
  return FINAL_KEY[final] ?? '?'
}

function encodePhoneticCode(initial: string, final: string): string {
  if (!initial) return `x${getFinalKey(initial, final)}`
  if (initial === 'sh') return `e${getFinalKey(initial, final)}`
  if (initial === 'zh') return `${ZH_OUTER_BASE.has(final) || ZH_FLY_FINALS.has(final) ? 'q' : 'f'}${getFinalKey(initial, final)}`
  if (initial === 'ch') return `${CH_OUTER_BASE.has(final) || CH_FLY_FINALS.has(final) ? 'j' : 'w'}${getFinalKey(initial, final)}`
  if (['j', 'q', 'x', 'y'].includes(initial) && (final === 'u' || final === 'ü')) return `${initial}l`
  return `${initial}${getFinalKey(initial, final)}`
}

function getPinyinForChar(char: string): string {
  const result = pinyin(char, { type: 'array', toneType: 'none' })
  return Array.isArray(result) ? result[0] ?? '' : ''
}

function getPinyinReadingsForChar(char: string): string[] {
  const result = pinyin(char, { type: 'array', toneType: 'none', multiple: true })
  return Array.isArray(result) ? Array.from(new Set(result.filter(Boolean))) : []
}

function getFlyKeyHints(initial: string, final: string): FlyKeyHint[] {
  const hints: FlyKeyHint[] = []

  if (initial === 'zh' && ZH_OUTER_BASE.has(final)) {
    hints.push({ id: 'zh-outer', label: 'zh 外', key: 'q', reason: `${final} 属于 zh 外韵，声母键取 Q` })
  }
  if (initial === 'zh' && ZH_FLY_FINALS.has(final)) {
    hints.push({ id: 'zh-outer', label: 'zh 外飞键', key: 'q / f', reason: `${final} 是 zh 外的飞键韵，可从 Q 飞到 F` })
  }
  if (initial === 'zh' && ZH_INNER.has(final)) {
    hints.push({ id: 'zh-inner', label: 'zh 内', key: 'f', reason: `${final} 属于 zh 内韵，声母键取 F` })
  }
  if (initial === 'ch' && CH_OUTER_BASE.has(final)) {
    hints.push({ id: 'ch-outer', label: 'ch 外', key: 'j', reason: `${final} 属于 ch 外韵，声母键取 J` })
  }
  if (initial === 'ch' && CH_FLY_FINALS.has(final)) {
    hints.push({ id: 'ch-outer', label: 'ch 外飞键', key: 'j / w', reason: `${final} 是 ch 外的飞键韵，可从 J 飞到 W` })
  }
  if (initial === 'ch' && CH_INNER.has(final)) {
    hints.push({ id: 'ch-inner', label: 'ch 内', key: 'w', reason: `${final} 属于 ch 内韵，声母键取 W` })
  }
  if (final === 'uang') {
    const isInner = initial === 'zh' || initial === 'ch'
    hints.push(isInner
      ? { id: 'uang-x', label: 'uang 特例', key: 'x', reason: 'uang 跟在 zh 内(F) / ch 内(W) 后，韵母键取 X' }
      : { id: 'uang-m', label: 'uang 特例', key: 'm', reason: 'uang 不在 zh 内 / ch 内声母后，韵母键取 M' })
  }

  return hints
}

function getFlyKeyHintsForChar(char: string): FlyKeyHint[] {
  const hints: FlyKeyHint[] = []
  const seenHints = new Set<string>()

  for (const reading of getPinyinReadingsForChar(char)) {
    const { initial, final } = parsePinyinSyllable(reading)
    for (const hint of getFlyKeyHints(initial, final)) {
      const key = `${hint.id}:${hint.key}:${hint.reason}`
      if (seenHints.has(key)) continue
      seenHints.add(key)
      hints.push(hint)
    }
  }

  return hints
}

function encodeComponent(component: string, rootMap: Record<string, string>): string {
  return Array.from(component).map((char) => rootMap[char] ?? '?').join('')
}

function createSingleCharacterItems(
  dictionary: PracticeDictionary,
  limit: number,
  filter?: (entry: PracticeEntry) => boolean
) {
  const byText = new Map<string, PracticeEntry>()
  for (const entry of dictionary.entries) {
    if (getTextLength(entry.text) !== 1) continue
    if (filter && !filter(entry)) continue
    const existing = byText.get(entry.text)
    if (!existing || (entry.weight ?? 0) > (existing.weight ?? 0)) byText.set(entry.text, entry)
  }

  return Array.from(byText.values())
    .sort((a, b) => {
      const rankA = COMMON_CHARACTER_RANK.get(a.text) ?? Number.MAX_SAFE_INTEGER
      const rankB = COMMON_CHARACTER_RANK.get(b.text) ?? Number.MAX_SAFE_INTEGER
      if (rankA !== rankB) return rankA - rankB
      return ((b.weight ?? 0) - (a.weight ?? 0)) || a.text.localeCompare(b.text, 'zh-Hans')
    })
    .slice(0, limit)
    .map((entry) => ({
      text: entry.text,
      codes: Array.from(new Set((dictionary.entriesByText.get(entry.text) ?? []).map((item) => item.code))).slice(0, 6),
    }))
}

function createFlyKeyPracticeItems(dictionary: PracticeDictionary, limit: number) {
  return Array.from(KEYTAO_FLY_KEY_CHARACTERS)
    .slice(0, limit)
    .flatMap((char) => {
      const dictionaryCodes = (dictionary.entriesByText.get(char) ?? []).map((entry) => entry.code)
      if (dictionaryCodes.length === 0) return []

      return [{
        text: char,
        codes: Array.from(new Set(dictionaryCodes)).slice(0, 6),
      }]
    })
}

function buildPracticeInsight(
  text: string | undefined,
  dictionary: PracticeDictionary | null,
  config: KeyTaoConfigData | null
): PracticeInsight | null {
  if (!text || !dictionary || !config) return null

  const codes = dictionary.entriesByText.get(text)?.map((entry) => entry.code).slice(0, 6) ?? []
  const characters = Array.from(text).map((char) => {
    const charCodes = dictionary.entriesByText.get(char)?.map((entry) => entry.code).slice(0, 6) ?? []
    const readings = getPinyinReadingsForChar(char)
    const charPinyin = readings[0] ?? getPinyinForChar(char)
    const { initial, final } = parsePinyinSyllable(charPinyin)
    const split = config.splitMap[char]
    const shapeCode = split
      ? `${encodeComponent(split.c1, config.rootMap)}${encodeComponent(split.c2, config.rootMap)}`
      : undefined

    return {
      char,
      pinyin: readings.length > 1 ? readings.join(' / ') : charPinyin,
      phoneticCode: encodePhoneticCode(initial, final),
      split,
      shapeCode,
      codes: charCodes,
      flyHints: getFlyKeyHintsForChar(char),
    }
  })

  return { text, codes, characters }
}

function formatRimeRuntimeReason(reason?: string): string {
  if (!reason) return '未找到可用的 Rime WASM 运行时'

  const missingMatch = reason.match(/Missing (.+?) in librime wasm runtime source directory/)
  if (missingMatch) {
    return `缺少 ${missingMatch[1]}，请把编译出的 Rime WASM 运行时放入 lib/librime-wasm/runtime 后重启 dev server`
  }

  if (reason.includes('manifest')) return '无法读取 /librime-wasm/manifest.json，请确认 dev server 已运行 prepare:librime-wasm'
  return reason
}

function getRimeDeployPath(zipEntryName: string): string | null {
  const parts = zipEntryName.split('/').filter(Boolean)
  const fileName = parts.at(-1)
  if (!fileName) return null

  const lowerName = fileName.toLowerCase()
  const deployable = lowerName.endsWith('.yaml')
    || lowerName.endsWith('.lua')
    || lowerName.endsWith('.json')
    || lowerName.endsWith('.bin')
    || lowerName.endsWith('.txt')
    || lowerName.endsWith('.ocd')

  if (!deployable) return null

  const luaIndex = parts.findIndex((part) => part.toLowerCase() === 'lua')
  if (luaIndex >= 0) return parts.slice(luaIndex).join('/')

  const openccIndex = parts.findIndex((part) => part.toLowerCase() === 'opencc')
  if (openccIndex >= 0) return parts.slice(openccIndex).join('/')

  const rimeIndex = parts.findLastIndex((part) => part.toLowerCase() === 'rime')
  if (rimeIndex >= 0 && parts.length > rimeIndex + 1) return parts.slice(rimeIndex + 1).join('/')

  return fileName
}

function stripRimeYamlScalar(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '')
}

function readRimeYamlScalar(content: string, key: string): string | null {
  const match = content.match(new RegExp(`^\\s*${key}:\\s*([^\\n#]+)`, 'm'))
  return match ? stripRimeYamlScalar(match[1]) : null
}

function readRimeSchemaMetadata(content: string): RimeSchema | null {
  const schemaBlock = content.match(/^schema:\s*\n((?:[ \t]+[^\n]*\n?)*)/m)?.[1] ?? ''
  const id = readRimeYamlScalar(schemaBlock, 'schema_id') ?? readRimeYamlScalar(content, 'schema_id')
  if (!id) return null

  return {
    id,
    name: readRimeYamlScalar(schemaBlock, 'name') ?? readRimeYamlScalar(content, 'name') ?? id,
  }
}

function mergeSchemaDisplayNames(schemas: RimeSchema[], files: RimeDeployFile[]): RimeSchema[] {
  const schemaNames = new Map<string, string>()
  const decoder = new TextDecoder('utf-8')

  for (const file of files) {
    if (!file.path.endsWith('.schema.yaml')) continue

    const metadata = readRimeSchemaMetadata(decoder.decode(new Uint8Array(file.content)))
    if (metadata) schemaNames.set(metadata.id, metadata.name)
  }

  return schemas.map((schema) => ({
    ...schema,
    name: schemaNames.get(schema.id) ?? schema.name,
  }))
}

async function readDownloadBlob(response: Response, onProgress: (progress: number) => void): Promise<Blob> {
  const contentLength = Number(response.headers.get('Content-Length') ?? 0)
  if (!response.body || !Number.isFinite(contentLength) || contentLength <= 0) {
    return await response.blob()
  }

  const reader = response.body.getReader()
  const chunks: ArrayBuffer[] = []
  let received = 0
  onProgress(0)

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue

    const chunk = new ArrayBuffer(value.byteLength)
    new Uint8Array(chunk).set(value)
    chunks.push(chunk)
    received += value.byteLength
    onProgress(Math.min(100, Math.round((received / contentLength) * 100)))
  }

  return new Blob(chunks, { type: response.headers.get('Content-Type') ?? 'application/zip' })
}

function InsightPanel({ title, insight }: { title: string; insight: PracticeInsight | null }) {
  return (
    <div className="rounded-small border border-default-200 bg-default-50/70 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-small font-semibold">{title}</div>
        {insight?.codes.length ? (
          <div className="flex flex-wrap justify-end gap-1">
            {insight.codes.slice(0, 3).map((code) => (
              <Chip key={code} size="sm" variant="flat" className="font-mono">{code}</Chip>
            ))}
          </div>
        ) : null}
      </div>
      {insight ? (
        <div className="mt-3 space-y-2">
          {insight.characters.map((item, index) => (
            <div key={`${item.char}-${index}`} className="rounded-small bg-content1 px-3 py-2 shadow-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-2xl font-semibold leading-none">{item.char}</span>
                <span className="font-mono text-small text-primary">{item.pinyin || 'unknown'}</span>
                <span className="font-mono text-small text-default-500">声韵 {item.phoneticCode}</span>
                {item.shapeCode && <span className="font-mono text-small text-default-500">形码 {item.shapeCode}</span>}
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-tiny text-default-500">
                {item.split ? (
                  <span>拆分：{item.split.c1 || '∅'} / {item.split.c2 || '∅'}</span>
                ) : <span>暂无拆分数据</span>}
                {item.codes.length > 0 && <span>词库编码：{item.codes.join(' / ')}</span>}
              </div>
              {item.flyHints.length > 0 && (
                <div className="mt-2 flex flex-col gap-1">
                  {item.flyHints.map((hint) => (
                    <div key={`${hint.id}-${hint.key}`} className="flex items-start gap-2 text-tiny text-warning-700 dark:text-warning-300">
                      <span className="font-mono font-semibold">{hint.key.toUpperCase()}</span>
                      <span>{hint.label}：{hint.reason}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-3 text-small text-default-400">等待目标字词</div>
      )}
    </div>
  )
}

function KeyToken({ value, active }: { value: string; active?: boolean }) {
  const match = active ? value.match(/^(.+?)([a-z])$/) : null
  return (
    <span className={`inline-flex h-5 items-center rounded-[5px] border px-1 text-[10px] leading-none ${active ? 'border-default-300 bg-default-200 text-default-700' : 'border-default-200 bg-content1 text-default-600'}`}>
      <span>{match ? match[1] : value}</span>
      {match && <span className="ml-0.5 text-tiny text-default-500">{match[2]}</span>}
    </span>
  )
}

function KeyBadge({ children, tone }: { children: string; tone: 'key' | 'initial' | 'root' | 'muted' }) {
  const colorClass = tone === 'key'
    ? 'bg-primary text-white'
    : tone === 'initial'
      ? 'bg-warning text-white'
      : tone === 'root'
        ? 'bg-success text-white'
        : 'bg-default-300 text-default-700'

  return <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-[5px] px-1.5 font-mono text-[12px] font-semibold leading-none ${colorClass}`}>{children}</span>
}

function StandardKeyTaoGraph({ visible }: { visible: boolean }) {
  if (!visible) return null

  return (
    <div className="overflow-hidden rounded-small border border-default-200 bg-content1 shadow-sm">
      <table className="w-full table-fixed border-collapse text-center">
        <tbody>
          {KEYBOARD_ROWS.map((row, rowIndex) => (
            <Fragment key={rowIndex}>
              <tr className="h-9 border-b border-default-200 bg-content1">
                {row.map((item) => {
                  const initial = 'initial' in item ? item.initial : undefined
                  const rootKey = 'rootKey' in item ? item.rootKey : undefined
                  const isSpecial = item.tone === 'special'
                  return (
                    <td key={`${item.keyName}-head`} className={`border-r border-default-200 px-1 py-1 align-middle last:border-r-0 ${isSpecial ? 'bg-success-50/50 dark:bg-success-50/10' : ''}`}>
                      <div className="flex flex-wrap items-center justify-center gap-1">
                        <KeyBadge tone="key">{item.keyName}</KeyBadge>
                        {initial && <KeyBadge tone="initial">{initial}</KeyBadge>}
                        {rootKey && <KeyBadge tone={rootKey === '~' ? 'muted' : 'root'}>{rootKey}</KeyBadge>}
                      </div>
                    </td>
                  )
                })}
              </tr>
              <tr className={`h-10 border-b border-default-200 last:border-b-0 ${rowIndex === 1 ? 'bg-default-50' : 'bg-content1'}`}>
                {row.map((item) => {
                  const isSpecial = item.tone === 'special'
                  const isBrand = item.tone === 'brand'
                  const tokens = ('roots' in item ? item.roots : item.finals) ?? []
                  const useTokenGrid = (isSpecial || isBrand) && tokens.length > 2
                  return (
                    <td key={`${item.keyName}-body`} className={`border-r border-default-200 px-1 py-1 align-middle last:border-r-0 ${isSpecial ? 'bg-success-50/50 dark:bg-success-50/10' : ''}`}>
                      <div className={useTokenGrid
                        ? 'grid min-h-7 grid-cols-2 place-items-center gap-0.5'
                        : 'flex min-h-7 flex-wrap items-center justify-center gap-0.5'}>
                        {tokens.map((token, tokenIndex) => <KeyToken key={`${token}-${tokenIndex}`} value={token} active={isSpecial || isBrand} />)}
                      </div>
                    </td>
                  )
                })}
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function KeydoGraph({ visible }: { visible: boolean }) {
  if (!visible) return null

  return (
    <div className="overflow-hidden rounded-small border border-default-200 bg-content1 shadow-sm">
      <table className="w-full table-fixed border-collapse text-center">
        <tbody>
          {KEYDO_GRAPH_ROWS.map((row, rowIndex) => (
            <Fragment key={`keydo-row-${rowIndex}`}>
              <tr className="h-9 border-b border-default-200 bg-content1">
                {row.map((item) => {
                  const hasActiveRootInfo = Boolean((item.rootKey && item.rootKey !== '~') || item.cornerLabel)
                  return (
                    <td
                      key={`${item.keyName}-head`}
                      className="border-r border-default-200 px-1 py-1 align-middle last:border-r-0"
                    >
                      <div className="flex flex-wrap items-center justify-center gap-1">
                        <KeyBadge tone="key">{item.keyName}</KeyBadge>
                        {item.phonetic && <KeyBadge tone="initial">{item.phonetic}</KeyBadge>}
                        {item.rootKey && <KeyBadge tone={item.rootKey === '~' ? 'muted' : 'root'}>{item.rootKey}</KeyBadge>}
                        {item.cornerLabel && <KeyBadge tone={hasActiveRootInfo ? 'root' : 'muted'}>{item.cornerLabel}</KeyBadge>}
                      </div>
                    </td>
                  )
                })}
              </tr>
              <tr className={`h-10 border-b border-default-200 last:border-b-0 ${rowIndex === 1 ? 'bg-default-50' : 'bg-content1'}`}>
                {row.map((item) => {
                  const hasActiveRootInfo = Boolean((item.rootKey && item.rootKey !== '~') || item.cornerLabel)
                  return (
                    <td
                      key={`${item.keyName}-body`}
                      className="border-r border-default-200 px-1 py-1 align-middle last:border-r-0"
                    >
                      <div className="grid min-h-7 place-items-center gap-0.5">
                        {item.bodyRows?.length ? item.bodyRows.map((bodyRow, bodyRowIndex) => (
                          <div key={`${item.keyName}-body-row-${bodyRowIndex}`} className="flex flex-wrap items-center justify-center gap-0.5">
                            {bodyRow.map((token, tokenIndex) => (
                              <KeyToken
                                key={`${item.keyName}-${token}-${tokenIndex}`}
                                value={token}
                                active={hasActiveRootInfo}
                              />
                            ))}
                          </div>
                        )) : <div className="text-default-300">&nbsp;</div>}
                      </div>
                    </td>
                  )
                })}
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function KeyTaoGraph({ visible, schemeKey }: { visible: boolean; schemeKey: PracticeSchemeKey }) {
  return schemeKey === 'keydo'
    ? <KeydoGraph visible={visible} />
    : <StandardKeyTaoGraph visible={visible} />
}

type FollowPracticeTextTone = 'done' | 'current' | 'pending'

interface FollowPracticeTextItemProps {
  text: string
  itemIndex: number
  tone: FollowPracticeTextTone
  overlaySegments: FollowCurrentItemSegment[] | null
  showInputError: boolean
  setCurrentTargetAnchor: (node: HTMLElement | null) => void
}

const FollowPracticeTextItem = memo(function FollowPracticeTextItem({
  text,
  itemIndex,
  tone,
  overlaySegments,
  showInputError,
  setCurrentTargetAnchor,
}: FollowPracticeTextItemProps) {
  const usesOverlaySegments = tone !== 'done' && Boolean(overlaySegments && overlaySegments.length > 0)

  return (
    <span
      ref={tone === 'current' ? setCurrentTargetAnchor : undefined}
      className={`mx-0.5 inline leading-none ${usesOverlaySegments ? '' : 'border-b-2 pb-1'} ${tone === 'done'
        ? 'border-success-400 text-success-500/80'
        : tone === 'current'
          ? showInputError ? 'border-danger text-danger' : 'border-primary text-foreground'
          : 'border-default-200 text-default-300'}`}
    >
      {usesOverlaySegments && overlaySegments
        ? overlaySegments.map((segment, segmentIndex) => (
          <span
            key={`${itemIndex}-segment-${segmentIndex}`}
            className={`inline border-b-2 pb-1 leading-none ${segment.tone === 'done'
              ? 'border-success-400 text-success-500/80'
              : segment.tone === 'wrong'
                ? 'border-danger text-danger'
                : tone === 'current' && showInputError
                  ? 'border-danger/40 text-danger/55'
                  : tone === 'current'
                    ? 'border-primary text-foreground'
                    : 'border-default-200 text-default-300'}`}
          >
            {renderFixedWidthText(segment.text, `${itemIndex}-segment-${segmentIndex}`)}
          </span>
        ))
        : renderFixedWidthText(text, `${itemIndex}`)}
    </span>
  )
})

export default function KeyTaoPracticePage() {
  const cardBodyRef = useRef<HTMLDivElement>(null)
  const inputSurfaceRef = useRef<HTMLDivElement>(null)
  const keyboardBridgeRef = useRef<HTMLInputElement>(null)
  const candidatePanelRef = useRef<HTMLDivElement>(null)
  const textUploadRef = useRef<HTMLInputElement>(null)
  const schemeUploadRef = useRef<HTMLInputElement>(null)
  const rimeEngineRef = useRef<LibrimeWasmEngine | null>(null)
  const pendingRimeDeployFilesRef = useRef<RimeDeployFile[]>([])
  const nextRimeDeployIdRef = useRef(0)
  const deployedRimeDeployIdRef = useRef(0)
  const activeSchemeDownloadIdRef = useRef(0)
  const didAutoLoadSchemeRef = useRef(false)
  const currentCommittedTextRef = useRef('')
  const currentItemTextRef = useRef<string | undefined>(undefined)
  const practiceTurnRef = useRef(0)
  const processRimeQueueRef = useRef<Promise<void>>(Promise.resolve())
  const currentTargetAnchorRef = useRef<HTMLElement | null>(null)

  const selectedSchemeKey = usePracticeStore((state) => state.selectedSchemeKey)
  const cachedSchemeVersions = usePracticeStore((state) => state.cachedSchemeVersions)
  const practiceSource = usePracticeStore((state) => state.practiceSource) as PracticeSource
  const selectedArticleId = usePracticeStore((state) => state.selectedArticleId)
  const practiceMode = usePracticeStore((state) => state.practiceMode) as PracticeMode
  const hasHydratedPracticeStore = usePracticeStore((state) => state.hasHydrated)
  const setSelectedSchemeKey = usePracticeStore((state) => state.setSelectedSchemeKey)
  const setPracticeSource = usePracticeStore((state) => state.setPracticeSource)
  const setSelectedArticleId = usePracticeStore((state) => state.setSelectedArticleId)
  const setStoredPracticeMode = usePracticeStore((state) => state.setPracticeMode)
  const upsertCachedSchemeVersion = usePracticeStore((state) => state.upsertCachedSchemeVersion)
  const removeCachedSchemeVersion = usePracticeStore((state) => state.removeCachedSchemeVersion)

  const [dictionary, setDictionary] = useState<PracticeDictionary | null>(null)
  const [schemeStatus, setSchemeStatus] = useState<SchemeStatus>('idle')
  const [schemeMessage, setSchemeMessage] = useState('等待加载键道方案')
  const [schemeDownloadProgress, setSchemeDownloadProgress] = useState<number | null>(null)
  const [articleOptions, setArticleOptions] = useState<PracticeArticleOption[]>(DEFAULT_PRACTICE_ARTICLE_OPTIONS)
  const [articleListMessage, setArticleListMessage] = useState('默认提供一篇内置长文，联网后会补充中文维基文库随机长文')
  const [isRefreshingArticles, setIsRefreshingArticles] = useState(false)
  const [sourceText, setSourceText] = useState(DEFAULT_PRACTICE_TEXT)
  const [draftText, setDraftText] = useState(DEFAULT_PRACTICE_TEXT)
  const [keytaoConfig, setKeytaoConfig] = useState<KeyTaoConfigData | null>(null)
  const [isKeyMapVisible, setIsKeyMapVisible] = useState(true)
  const [isInsightPanelVisible, setIsInsightPanelVisible] = useState(true)
  const [isFlyRulePanelVisible, setIsFlyRulePanelVisible] = useState(true)
  const [practiceShuffleSeed, setPracticeShuffleSeed] = useState(0)
  const [currentCommittedText, setCurrentCommittedText] = useState('')
  const [currentIndex, setCurrentIndex] = useState(0)
  const [completedText, setCompletedText] = useState('')
  const [totalKeys, setTotalKeys] = useState(0)
  const [wrongKeys, setWrongKeys] = useState(0)
  const [startTime, setStartTime] = useState<number | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [isPracticeFocused, setIsPracticeFocused] = useState(false)
  const [rimeStatus, setRimeStatus] = useState<LibrimeWasmStatus>('checking')
  const [rimeMessage, setRimeMessage] = useState('正在检查浏览器 librime wasm 运行时')
  const [rimeDetail, setRimeDetail] = useState('读取 /librime-wasm/manifest.json')
  const [rimeProgress, setRimeProgress] = useState(10)
  const [rimeSchemas, setRimeSchemas] = useState<RimeSchema[]>([])
  const [selectedSchemaId, setSelectedSchemaId] = useState<string | null>(null)
  const [rimeComposition, setRimeComposition] = useState<RimeComposition | null>(null)
  const [pendingRimeDeployRequest, setPendingRimeDeployRequest] = useState<{ id: number; sourceName: string } | null>(null)
  const [isTouchLayout, setIsTouchLayout] = useState(false)
  const [candidateOverlayStyle, setCandidateOverlayStyle] = useState<{ top: number; left: number; maxWidth: number } | null>(null)
  const [mobileCandidateOverlayTop, setMobileCandidateOverlayTop] = useState<number | null>(null)
  const rimeStatusRef = useRef(rimeStatus)
  const selectedSchemaIdRef = useRef(selectedSchemaId)
  const pendingStudyAutoCommitTimerRef = useRef<number | null>(null)

  const selectedArticle = useMemo(
    () => articleOptions.find((article) => article.id === selectedArticleId) ?? articleOptions[0] ?? DEFAULT_PRACTICE_ARTICLE_OPTIONS[0],
    [articleOptions, selectedArticleId]
  )
  const selectedScheme = useMemo(
    () => PRACTICE_SCHEME_OPTIONS.find((scheme) => scheme.key === selectedSchemeKey) ?? PRACTICE_SCHEME_OPTIONS[0],
    [selectedSchemeKey]
  )
  const selectedRimeSchema = useMemo(
    () => rimeSchemas.find((schema) => schema.id === selectedSchemaId) ?? null,
    [rimeSchemas, selectedSchemaId]
  )
  const selectedSchemeCachedVersions = cachedSchemeVersions[selectedSchemeKey] ?? []

  const practiceItemsBase = useMemo(() => {
    if (!dictionary) return []
    if (practiceSource === 'common500') return createSingleCharacterItems(dictionary, 500)
    if (practiceSource === 'common1000') return createSingleCharacterItems(dictionary, 1000)
    if (practiceSource === 'keytao630') {
      return createPracticeItemsFromText(KEYTAO_630_TEXT, dictionary, Number.MAX_SAFE_INTEGER)
    }
    if (practiceSource === 'flyKey') {
      return createFlyKeyPracticeItems(dictionary, 1000)
    }
    const content = practiceSource === 'article' ? selectedArticle.text : sourceText
    return createPracticeItemsFromText(content, dictionary, Number.MAX_SAFE_INTEGER)
  }, [dictionary, practiceSource, selectedArticle.text, sourceText])

  const practiceItems = useMemo(() => {
    if (practiceShuffleSeed === 0) return practiceItemsBase
    return shufflePracticeItems(practiceItemsBase)
  }, [practiceItemsBase, practiceShuffleSeed])

  const currentItem = practiceItems[currentIndex]
  const previousPreviewItems = [practiceItems[currentIndex - 2] ?? null, practiceItems[currentIndex - 1] ?? null]
  const nextPreviewItems = [practiceItems[currentIndex + 1] ?? null, practiceItems[currentIndex + 2] ?? null]
  const currentInsight = useMemo(
    () => buildPracticeInsight(currentItem?.text, dictionary, keytaoConfig),
    [currentItem?.text, dictionary, keytaoConfig]
  )

  const remainingPracticeTexts = useMemo(
    () => practiceItems.slice(currentIndex).map((item) => item.text),
    [currentIndex, practiceItems]
  )
  const remainingPracticeText = useMemo(
    () => remainingPracticeTexts.join(''),
    [remainingPracticeTexts]
  )
  const isStudyMode = practiceMode === 'study'
  const isRimeReady = rimeStatus === 'ready' && Boolean(rimeEngineRef.current)
  const currentTargetCodes = useMemo(
    () => currentItem?.codes?.slice(0, 6) ?? currentInsight?.codes ?? [],
    [currentInsight?.codes, currentItem?.codes]
  )
  const followRenderedSegments = useMemo(
    () => splitFollowRemainingTexts(remainingPracticeTexts, currentCommittedText),
    [currentCommittedText, remainingPracticeTexts]
  )
  const displayedInput = isStudyMode
    ? `${currentCommittedText}${rimeComposition?.preedit ?? ''}`
    : (rimeComposition?.preedit ?? '')
  const displayedCandidates = useMemo(
    () => (rimeComposition?.candidates ?? EMPTY_RIME_CANDIDATES).slice(0, MAX_DISPLAYED_CANDIDATES),
    [rimeComposition?.candidates]
  )
  const displayedCandidateItems = useMemo(() => displayedCandidates.map((candidate, index) => {
    const studyResolution = resolvePracticeCommit({
      currentCommittedText,
      committedText: candidate.text,
      currentTargetText: currentItem?.text,
    })
    const followResolution = resolveFollowPracticeCommit({
      currentCommittedText,
      committedText: candidate.text,
      remainingTexts: remainingPracticeTexts,
      remainingTargetText: remainingPracticeText,
    })
    const isValidTarget = isStudyMode
      ? studyResolution.type === 'partial' || studyResolution.type === 'complete'
      : followResolution.type === 'match'
    const isExactTarget = isStudyMode
      ? studyResolution.type === 'complete'
      : followResolution.type === 'match' && followResolution.advanceCount > 0

    return {
      candidate,
      index,
      candidateHint: candidate.comment,
      isValidTarget,
      isExactTarget,
    }
  }), [currentCommittedText, currentItem?.text, displayedCandidates, isStudyMode, remainingPracticeText, remainingPracticeTexts])
  const displayedCandidateMeasureKey = useMemo(
    () => displayedCandidateItems.map(({ candidate, candidateHint }) => `${candidate.text}\u0000${candidateHint ?? ''}`).join('\u0001'),
    [displayedCandidateItems]
  )
  const hasInputError = feedback?.startsWith('当前输入')
    || feedback?.startsWith('已选')
    || feedback?.startsWith('输入法提交')
    || feedback?.startsWith('真实 Rime')
    || false
  const showRimeStatus = true
  const isPracticeLoading = schemeStatus === 'loading' || !dictionary
  const hasPracticeItems = practiceItems.length > 0
  const isPracticeEmpty = !isPracticeLoading && !hasPracticeItems

  const practiceKey = useMemo(
    () => practiceItems.map((item) => item.text).join('|'),
    [practiceItems]
  )

  const progressValue = practiceItems.length > 0
    ? Math.round((currentIndex / practiceItems.length) * 100)
    : 0
  const speedDecimal = elapsedMs > 0 ? (completedText.length / (elapsedMs / 60000)).toFixed(2) : '0.00'
  const keystrokesPerChar = completedText.length > 0 ? (totalKeys / completedText.length).toFixed(2) : '0.00'
  const avgCodeLength = useMemo(() => {
    if (currentIndex === 0 || completedText.length === 0) return '0.00'
    const totalCodeLen = practiceItems
      .slice(0, currentIndex)
      .reduce((sum, item) => sum + (item.codes[0]?.length ?? 0), 0)
    return (totalCodeLen / completedText.length).toFixed(2)
  }, [currentIndex, completedText.length, practiceItems])
  const wrongItems = useMemo(() => {
    if (!currentCommittedText) return 0
    const committedChars = Array.from(currentCommittedText)
    const targetChars = Array.from(remainingPracticeText)
    let wrong = 0
    for (let i = 0; i < committedChars.length; i += 1) {
      if (i >= targetChars.length || committedChars[i] !== targetChars[i]) {
        wrong += 1
      }
    }
    return wrong
  }, [currentCommittedText, remainingPracticeText])
  const keyAccuracy = totalKeys > 0 ? Math.max(0, ((totalKeys - wrongKeys) / totalKeys) * 100).toFixed(2) : '100.00'
  const isFinished = practiceItems.length > 0 && currentIndex >= practiceItems.length
  const schemeStatusLabel = schemeStatus === 'loading'
    ? '下载中'
    : schemeStatus === 'ready'
      ? '已就绪'
      : schemeStatus === 'error'
        ? '加载失败'
        : '待加载'
  const schemeDetailLabel = schemeStatus === 'ready'
    ? `${selectedScheme.label}${dictionary?.version ? ` · ${dictionary.version}` : ''}`
    : schemeMessage
  const rimeStatusLabel = rimeStatus === 'ready'
    ? '已就绪'
    : rimeStatus === 'checking'
      ? '启动中'
      : rimeStatus === 'error'
        ? '错误'
        : '不可用'
  const rimeDetailLabel = rimeStatus === 'ready'
    ? `${selectedRimeSchema?.name ?? '已部署方案'}${rimeSchemas.length > 0 ? ` · ${rimeSchemas.length} 个方案` : ''}`
    : rimeDetail || rimeMessage

  const focusPracticeSurface = useCallback(() => {
    const shouldUseKeyboardBridge = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0
    const target = shouldUseKeyboardBridge ? keyboardBridgeRef.current : inputSurfaceRef.current
    target?.focus({ preventScroll: true })
  }, [])

  const setCurrentTargetAnchor = useCallback((node: HTMLElement | null) => {
    currentTargetAnchorRef.current = node
  }, [])

  const updateCandidateOverlayPosition = useCallback(() => {
    if (isTouchLayout || !cardBodyRef.current || !currentTargetAnchorRef.current) {
      setCandidateOverlayStyle(null)
      return
    }

    const anchorRect = currentTargetAnchorRef.current.getBoundingClientRect()
    const minWidth = 180
    const minLeft = 12
    const viewportWidth = window.visualViewport?.width ?? window.innerWidth
    const maxLeft = Math.max(minLeft, viewportWidth - minLeft - minWidth)
    const anchorLeft = anchorRect.left
    const left = Math.min(Math.max(anchorLeft, minLeft), maxLeft)
    const maxWidth = Math.max(minWidth, viewportWidth - left - minLeft)
    const top = anchorRect.bottom + 14

    setCandidateOverlayStyle({ top, left, maxWidth })
  }, [isTouchLayout])

  const updateMobileCandidateOverlayPosition = useCallback(() => {
    if (!isTouchLayout || !candidatePanelRef.current) {
      setMobileCandidateOverlayTop(null)
      return
    }

    const viewport = window.visualViewport
    const viewportTop = viewport?.offsetTop ?? 0
    const viewportHeight = viewport?.height ?? window.innerHeight
    const panelHeight = candidatePanelRef.current.getBoundingClientRect().height
    const gap = 12
    const nextTop = Math.max(viewportTop + gap, viewportTop + viewportHeight - panelHeight - gap)

    setMobileCandidateOverlayTop(Math.round(nextTop))
  }, [isTouchLayout])

  const scrollCurrentTargetIntoView = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const surface = inputSurfaceRef.current
    const anchor = currentTargetAnchorRef.current
    if (!surface || !anchor || isStudyMode) return

    const surfaceRect = surface.getBoundingClientRect()
    const anchorRect = anchor.getBoundingClientRect()
    const candidateHeight = candidatePanelRef.current?.getBoundingClientRect().height ?? 0
    const topGuard = surfaceRect.top + 36
    const bottomGuard = surfaceRect.bottom - Math.min(candidateHeight + 28, surfaceRect.height * 0.38)

    if (anchorRect.top < topGuard) {
      surface.scrollBy({ top: anchorRect.top - topGuard, behavior })
      return
    }

    if (anchorRect.bottom > bottomGuard) {
      surface.scrollBy({ top: anchorRect.bottom - bottomGuard, behavior })
    }
  }, [isStudyMode])

  const clearPendingStudyAutoCommit = useCallback(() => {
    if (pendingStudyAutoCommitTimerRef.current === null) return
    window.clearTimeout(pendingStudyAutoCommitTimerRef.current)
    pendingStudyAutoCommitTimerRef.current = null
  }, [])

  const bumpPracticeTurn = useCallback(() => {
    practiceTurnRef.current += 1
    clearPendingStudyAutoCommit()
  }, [clearPendingStudyAutoCommit])

  const resetRimeSession = useCallback(async () => {
    const engine = rimeEngineRef.current
    if (!engine) return

    const schemaId = selectedSchemaIdRef.current
    if (schemaId) {
      await engine.selectSchema(schemaId)
      return
    }

    await engine.reset()
  }, [])

  useEffect(() => {
    rimeStatusRef.current = rimeStatus
  }, [rimeStatus])

  useEffect(() => {
    selectedSchemaIdRef.current = selectedSchemaId
  }, [selectedSchemaId])

  useEffect(() => {
    currentCommittedTextRef.current = currentCommittedText
  }, [currentCommittedText])

  useEffect(() => {
    currentItemTextRef.current = currentItem?.text
  }, [currentItem?.text])

  useEffect(() => {
    const mediaQuery = window.matchMedia('(pointer: coarse)')
    const updateTouchLayout = () => {
      setIsTouchLayout(mediaQuery.matches || navigator.maxTouchPoints > 0 || window.innerWidth < 768)
    }

    updateTouchLayout()
    mediaQuery.addEventListener('change', updateTouchLayout)
    window.addEventListener('resize', updateTouchLayout)
    return () => {
      mediaQuery.removeEventListener('change', updateTouchLayout)
      window.removeEventListener('resize', updateTouchLayout)
    }
  }, [])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      updateCandidateOverlayPosition()
      updateMobileCandidateOverlayPosition()
    })

    const surface = inputSurfaceRef.current
    const viewport = window.visualViewport
    if (!surface) {
      return () => window.cancelAnimationFrame(frame)
    }

    surface.addEventListener('scroll', updateCandidateOverlayPosition, { passive: true })
    window.addEventListener('resize', updateCandidateOverlayPosition)
    window.addEventListener('resize', updateMobileCandidateOverlayPosition)
    viewport?.addEventListener('resize', updateMobileCandidateOverlayPosition)
    viewport?.addEventListener('scroll', updateMobileCandidateOverlayPosition)
    return () => {
      window.cancelAnimationFrame(frame)
      surface.removeEventListener('scroll', updateCandidateOverlayPosition)
      window.removeEventListener('resize', updateCandidateOverlayPosition)
      window.removeEventListener('resize', updateMobileCandidateOverlayPosition)
      viewport?.removeEventListener('resize', updateMobileCandidateOverlayPosition)
      viewport?.removeEventListener('scroll', updateMobileCandidateOverlayPosition)
    }
  }, [currentIndex, displayedCandidateMeasureKey, isPracticeFocused, isStudyMode, updateCandidateOverlayPosition, updateMobileCandidateOverlayPosition])

  useEffect(() => {
    if (isStudyMode) return

    const frame = window.requestAnimationFrame(() => {
      scrollCurrentTargetIntoView(currentIndex > 1 ? 'smooth' : 'auto')
    })

    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [currentCommittedText, currentIndex, isStudyMode, scrollCurrentTargetIntoView])

  const deployRimeFiles = useCallback(async (files: RimeDeployFile[], sourceName: string) => {
    const engine = rimeEngineRef.current
    if (!engine || files.length === 0) return

    setRimeStatus('checking')
    setRimeMessage(`正在向 librime 部署 ${sourceName}`)
    setRimeDetail(`写入 ${files.length} 个 Rime 配置、词典和脚本文件`)
    setRimeProgress(70)
    await engine.deploy(files)

    setRimeDetail('读取 librime 部署后的 schema 列表')
    setRimeProgress(85)
    const schemas = mergeSchemaDisplayNames(await engine.listSchemas(), files)
    setRimeSchemas(schemas)

    if (schemas[0]) {
      setRimeDetail(`切换到 ${schemas[0].name || schemas[0].id}`)
      setRimeProgress(92)
      await engine.selectSchema(schemas[0].id)
      setSelectedSchemaId(schemas[0].id)
    }

    setRimeStatus('ready')
    setRimeProgress(100)
    setRimeDetail(schemas.length > 0 ? `${schemas.length} 个方案可用` : 'librime 已启动，但未返回可用方案')
    setRimeMessage(schemas.length > 0
      ? `已部署 ${sourceName}，当前使用 ${schemas[0]?.name ?? schemas[0]?.id}`
      : `已部署 ${sourceName}`)
  }, [])

  const loadDictionaryFromZip = useCallback(async (
    blob: Blob,
    sourceName: string,
    version?: string
  ) => {
    const zip = await JSZip.loadAsync(blob)
    const entries: PracticeEntry[] = []
    const deployFiles: RimeDeployFile[] = []
    const sourceFiles: string[] = []

    for (const zipEntry of Object.values(zip.files)) {
      if (zipEntry.dir) continue

      const deployPath = getRimeDeployPath(zipEntry.name)
      if (deployPath) {
        deployFiles.push({
          path: deployPath,
          content: await zipEntry.async('arraybuffer'),
        })
      }

      if (zipEntry.name.endsWith('.dict.yaml')) {
        const content = await zipEntry.async('text')
        const parsedEntries = parseRimeDictContent(content, zipEntry.name)
        if (parsedEntries.length === 0) continue
        for (const entry of parsedEntries) entries.push(entry)
        sourceFiles.push(zipEntry.name)
      }
    }

    if (entries.length === 0) {
      throw new Error('压缩包里没有可识别的 Rime .dict.yaml 词典')
    }

    setDictionary(buildPracticeDictionary(entries, { sourceFiles, sourceName, version }))
    pendingRimeDeployFilesRef.current = deployFiles
    setPendingRimeDeployRequest({ id: ++nextRimeDeployIdRef.current, sourceName })
    setSchemeStatus('ready')
    setSchemeMessage(`已加载 ${entries.length.toLocaleString()} 条词典记录，来自 ${sourceFiles.length} 个 Rime 词典文件`)
  }, [])

  const loadLatestCachedSchemeFallback = useCallback(async (schemeKey: PracticeSchemeKey) => {
    const cachedVersions = cachedSchemeVersions[schemeKey] ?? []

    for (const version of cachedVersions) {
      const cachedZip = await getCachedPracticeSchemeZip(version.schemeKey, version.version)
      if (!cachedZip) {
        removeCachedSchemeVersion(version.schemeKey, version.version)
        continue
      }

      setSelectedSchemeKey(version.schemeKey)
      setSchemeStatus('loading')
      setSchemeDownloadProgress(null)
      setSchemeMessage(`离线使用本地 ${version.label} ${version.version}`)

      try {
        await loadDictionaryFromZip(cachedZip.blob, `${version.label} ${version.version}`, version.version)
        setFeedback(`当前离线，已回退到本地 ${version.label} ${version.version}`)
        return true
      } catch {
        continue
      }
    }

    return false
  }, [cachedSchemeVersions, loadDictionaryFromZip, removeCachedSchemeVersion, setSelectedSchemeKey])

  const loadPracticeScheme = useCallback(async (schemeKey: PracticeSchemeKey) => {
    const scheme = PRACTICE_SCHEME_OPTIONS.find((item) => item.key === schemeKey) ?? PRACTICE_SCHEME_OPTIONS[0]
    const downloadId = ++activeSchemeDownloadIdRef.current
    setSelectedSchemeKey(schemeKey)
    setSchemeStatus('loading')
    setSchemeMessage(schemeKey === 'keydo' ? `正在获取 ${scheme.label} pre-release 方案` : `正在获取 latest ${scheme.label} 方案`)
    setSchemeDownloadProgress(null)
    setFeedback(null)

    if (isBrowserOffline()) {
      const loadedFallback = await loadLatestCachedSchemeFallback(schemeKey)
      if (loadedFallback || activeSchemeDownloadIdRef.current !== downloadId) return
      setSchemeStatus('error')
      setSchemeMessage(`当前离线，且本机还没有可用的 ${scheme.label} 方案包缓存`)
      return
    }

    try {
      const releaseResponse = await fetch(`/api/practice/scheme-release?scheme=${schemeKey}`)
      if (!releaseResponse.ok) throw new Error(`无法获取 ${scheme.label} 方案版本信息`)
      const release = await releaseResponse.json() as PracticeSchemeReleaseInfo
      if (!release.downloadUrl) throw new Error(`${scheme.label} 版本中没有 ${scheme.asset}`)
      if (activeSchemeDownloadIdRef.current !== downloadId) return

      const cachedZip = await getCachedPracticeSchemeZip(schemeKey, release.version)
      if (activeSchemeDownloadIdRef.current !== downloadId) return
      if (cachedZip) {
        setSchemeMessage(`正在使用本地 ${release.label} ${release.version} 方案包`)
        setSchemeDownloadProgress(null)
        await loadDictionaryFromZip(cachedZip.blob, `${release.label} ${release.version}`, release.version)
        return
      }

      setSchemeMessage(`正在下载 ${release.label} ${release.version} 的 ${release.assetName}`)
      setSchemeDownloadProgress(null)
      const downloadResponse = await fetch(`/api/install/download?url=${encodeURIComponent(release.downloadUrl)}`)
      if (!downloadResponse.ok) throw new Error(`${scheme.label} 方案包下载失败`)
      if (activeSchemeDownloadIdRef.current !== downloadId) return

      const blob = await readDownloadBlob(downloadResponse, (progress) => {
        if (activeSchemeDownloadIdRef.current === downloadId) setSchemeDownloadProgress(progress)
      })
      if (activeSchemeDownloadIdRef.current !== downloadId) return

      setSchemeMessage(`正在解析 ${release.label} ${release.version} 方案包`)
      setSchemeDownloadProgress(null)
      const cachedVersion: CachedPracticeSchemeVersion = {
        schemeKey,
        label: release.label,
        version: release.version,
        assetName: release.assetName,
        downloadedAt: new Date().toISOString(),
        size: blob.size,
      }
      await putCachedPracticeSchemeZip({
        id: `${schemeKey}:${release.version}`,
        ...cachedVersion,
        blob,
      })
      upsertCachedSchemeVersion(cachedVersion)
      if (activeSchemeDownloadIdRef.current !== downloadId) return

      await loadDictionaryFromZip(blob, `${release.label} ${release.version}`, release.version)
      if (activeSchemeDownloadIdRef.current !== downloadId) return
      setSchemeDownloadProgress(null)
    } catch (error) {
      if (activeSchemeDownloadIdRef.current !== downloadId) return
      const loadedFallback = await loadLatestCachedSchemeFallback(schemeKey)
      if (loadedFallback) return
      setSchemeStatus('error')
      setSchemeDownloadProgress(null)
      setSchemeMessage(error instanceof Error ? error.message : '键道方案加载失败')
    }
  }, [loadDictionaryFromZip, loadLatestCachedSchemeFallback, setSelectedSchemeKey, upsertCachedSchemeVersion])

  const loadCachedPracticeScheme = useCallback(async (version: CachedPracticeSchemeVersion) => {
    const cachedZip = await getCachedPracticeSchemeZip(version.schemeKey, version.version)
    if (!cachedZip) {
      removeCachedSchemeVersion(version.schemeKey, version.version)
      setSchemeStatus('error')
      setSchemeMessage(`本地 ${version.label} ${version.version} 缓存已不存在`)
      return
    }

    activeSchemeDownloadIdRef.current += 1
    setSelectedSchemeKey(version.schemeKey)
    setSchemeStatus('loading')
    setSchemeDownloadProgress(null)
    setSchemeMessage(`正在使用本地 ${version.label} ${version.version} 方案包`)
    try {
      await loadDictionaryFromZip(cachedZip.blob, `${version.label} ${version.version}`, version.version)
    } catch (error) {
      setSchemeStatus('error')
      setSchemeMessage(error instanceof Error ? error.message : '本地方案包解析失败')
    }
  }, [loadDictionaryFromZip, removeCachedSchemeVersion, setSelectedSchemeKey])

  const deleteCachedPracticeScheme = useCallback(async (version: CachedPracticeSchemeVersion) => {
    await deleteCachedPracticeSchemeZip(version.schemeKey, version.version)
    removeCachedSchemeVersion(version.schemeKey, version.version)
    setFeedback(`已删除本地 ${version.label} ${version.version}`)
  }, [removeCachedSchemeVersion])

  const resetSession = useCallback(() => {
    bumpPracticeTurn()
    setCurrentIndex(0)
    setCompletedText('')
    currentCommittedTextRef.current = ''
    setCurrentCommittedText('')
    setTotalKeys(0)
    setWrongKeys(0)
    setRimeComposition(null)
    if (rimeStatusRef.current === 'ready') {
      void resetRimeSession().catch(() => undefined)
    }
    setStartTime(null)
    setElapsedMs(0)
    setFeedback(null)
    focusPracticeSurface()
  }, [bumpPracticeTurn, focusPracticeSurface, resetRimeSession])

  const completeCurrentItem = useCallback((carryOverComposition: RimeComposition | null = null) => {
    if (!currentItem) return
    const nextComposition = currentIndex + 1 < practiceItems.length ? carryOverComposition : null
    bumpPracticeTurn()
    setCompletedText((value) => value + currentItem.text)
    setCurrentIndex((value) => value + 1)
    currentCommittedTextRef.current = ''
    setCurrentCommittedText('')
    setRimeComposition(nextComposition)
    setFeedback(null)
    if (rimeStatusRef.current === 'ready' && !nextComposition) {
      void resetRimeSession().catch(() => undefined)
    }
  }, [bumpPracticeTurn, currentIndex, currentItem, practiceItems.length, resetRimeSession])

  const applyFollowCommittedText = useCallback((committedText: string, composition?: RimeComposition | null) => {
    const resolution = resolveFollowPracticeCommit({
      currentCommittedText: currentCommittedTextRef.current,
      committedText,
      remainingTexts: remainingPracticeTexts,
      remainingTargetText: remainingPracticeText,
      composition,
    })

    if (resolution.type === 'noop') return

    if (resolution.type === 'mismatch') {
      setWrongKeys((value) => value + 1)
      currentCommittedTextRef.current = resolution.attemptedText
      setCurrentCommittedText(resolution.attemptedText)
      const currentTargetText = practiceItems[currentIndex]?.text ?? ''
      setFeedback(`当前输入「${committedText}」，目标是「${currentTargetText}」`)
      return
    }

    const nextComposition = currentIndex + resolution.advanceCount < practiceItems.length
      ? resolution.carryOverComposition
      : null

    if (resolution.advanceCount > 0) {
      bumpPracticeTurn()
      setCompletedText((value) => value + resolution.completedTexts.join(''))
      setCurrentIndex((value) => value + resolution.advanceCount)
      currentCommittedTextRef.current = resolution.currentText
      setCurrentCommittedText(resolution.currentText)
      setRimeComposition(nextComposition)
      setFeedback(null)
      if (rimeStatusRef.current === 'ready' && !nextComposition) {
        void resetRimeSession().catch(() => undefined)
      }
      return
    }

    currentCommittedTextRef.current = resolution.currentText
    setCurrentCommittedText(resolution.currentText)
    setRimeComposition(nextComposition)
    setFeedback(null)
  }, [bumpPracticeTurn, currentIndex, practiceItems, remainingPracticeText, remainingPracticeTexts, resetRimeSession])

  const applyFollowBackspace = useCallback(() => {
    const prevCommittedText = currentCommittedTextRef.current
    const nextCommittedText = Array.from(prevCommittedText).slice(0, -1).join('')

    currentCommittedTextRef.current = nextCommittedText
    setCurrentCommittedText(nextCommittedText)

    if (!nextCommittedText) {
      setFeedback(null)
      return
    }

    const resolution = resolveFollowPracticeCommit({
      currentCommittedText: '',
      committedText: nextCommittedText,
      remainingTexts: remainingPracticeTexts,
      remainingTargetText: remainingPracticeText,
    })

    if (resolution.type === 'mismatch') {
      setFeedback(`当前输入「${resolution.attemptedText}」，目标是「${resolution.targetText}」`)
      return
    }

    setFeedback(null)
  }, [remainingPracticeText, remainingPracticeTexts])

  const skipCurrentItem = useCallback(() => {
    if (!currentItem) return
    bumpPracticeTurn()
    setCurrentIndex((value) => value + 1)
    currentCommittedTextRef.current = ''
    setCurrentCommittedText('')
    setRimeComposition(null)
    setFeedback(`已跳过「${currentItem.text}」`)
    if (rimeStatusRef.current === 'ready') {
      void resetRimeSession().catch(() => undefined)
    }
    focusPracticeSurface()
  }, [bumpPracticeTurn, currentItem, focusPracticeSurface, resetRimeSession])

  const rewindToPreviousItem = useCallback(() => {
    if (currentIndex <= 0) return false

    const previousText = practiceItems[currentIndex - 1]?.text ?? ''
    bumpPracticeTurn()
    setCurrentIndex((value) => Math.max(0, value - 1))
    if (previousText) {
      setCompletedText((value) => value.endsWith(previousText) ? value.slice(0, -previousText.length) : value)
    }
    currentCommittedTextRef.current = ''
    setCurrentCommittedText('')
    setRimeComposition(null)
    setFeedback(null)
    if (rimeStatusRef.current === 'ready') {
      void resetRimeSession().catch(() => undefined)
    }
    focusPracticeSurface()
    return true
  }, [bumpPracticeTurn, currentIndex, focusPracticeSurface, practiceItems, resetRimeSession])

  const applyCommittedText = useCallback((committedText: string, composition?: RimeComposition | null) => {
    if (!isStudyMode) {
      applyFollowCommittedText(committedText, composition)
      return
    }

    const resolution = resolvePracticeCommit({
      currentCommittedText: currentCommittedTextRef.current,
      committedText,
      currentTargetText: currentItemTextRef.current,
      composition,
    })

    if (resolution.type === 'noop') return

    if (resolution.type === 'complete') {
      completeCurrentItem(resolution.carryOverComposition)
      return
    }

    if (resolution.type === 'partial') {
      currentCommittedTextRef.current = resolution.text
      setCurrentCommittedText(resolution.text)
      setFeedback(null)
      return
    }

    setWrongKeys((value) => value + 1)
    setFeedback(`当前输入「${resolution.attemptedText}」，目标是「${resolution.targetText}」`)
  }, [applyFollowCommittedText, completeCurrentItem, isStudyMode])

  const applyRimeResult = useCallback((result: RimeProcessResult) => {
    setRimeComposition(result.composition ?? null)

    if (!result.committedText) {
      setFeedback(null)
      return
    }

    applyCommittedText(result.committedText, result.composition ?? null)
  }, [applyCommittedText])

  const processRimeKey = useCallback(async (key: string) => {
    const turn = practiceTurnRef.current
    processRimeQueueRef.current = processRimeQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const engine = rimeEngineRef.current
        if (!engine) return

        try {
          clearPendingStudyAutoCommit()
          const result = await engine.processKey(key)
          if (turn !== practiceTurnRef.current) {
            await resetRimeSession()
            return
          }

          const currentTargetText = currentItemTextRef.current
          const autoCommitCandidateIndex = isStudyMode
            ? findAutoCommitCandidateIndex(result.composition, currentCommittedTextRef.current, currentTargetText, currentTargetCodes)
            : -1

          if (autoCommitCandidateIndex >= 0) {
            const selectedResult = await engine.selectCandidate(autoCommitCandidateIndex)
            if (turn !== practiceTurnRef.current) {
              await resetRimeSession()
              return
            }
            applyRimeResult(selectedResult)
            return
          }

          applyRimeResult(result)
        } catch (error) {
          setRimeStatus('error')
          setRimeMessage(error instanceof Error ? error.message : 'librime wasm 输入失败')
        }
      })
  }, [applyRimeResult, clearPendingStudyAutoCommit, currentTargetCodes, isStudyMode, resetRimeSession])

  const submitRimeKey = useCallback((key: string) => {
    if (!currentItem || isFinished) return false

    if (!isStudyMode && key === '{BackSpace}' && !rimeComposition?.preedit && currentCommittedTextRef.current) {
      if (!startTime) setStartTime(Date.now())
      setTotalKeys((value) => value + 1)
      applyFollowBackspace()
      return true
    }

    if (!isRimeReady) {
      setFeedback('真实 Rime 运行时未就绪，不能开始输入练习')
      return true
    }

    if (!startTime) setStartTime(Date.now())
    setTotalKeys((value) => value + 1)
    void processRimeKey(key)
    return true
  }, [applyFollowBackspace, currentItem, isFinished, isRimeReady, isStudyMode, processRimeKey, rimeComposition?.preedit, startTime])

  const submitPracticeKeys = useCallback((keys: string[]) => {
    for (const key of keys) submitRimeKey(key)
    return true
  }, [submitRimeKey])

  const selectRimeCandidate = useCallback(async (index: number) => {
    const engine = rimeEngineRef.current
    if (!engine) return

    try {
      applyRimeResult(await engine.selectCandidate(index))
      focusPracticeSurface()
    } catch (error) {
      setRimeStatus('error')
      setRimeMessage(error instanceof Error ? error.message : '候选选择失败')
    }
  }, [applyRimeResult, focusPracticeSurface])

  const changeRimePage = useCallback(async (backward: boolean) => {
    const engine = rimeEngineRef.current
    if (!engine) return

    try {
      applyRimeResult(await engine.changePage(backward))
    } catch (error) {
      setRimeStatus('error')
      setRimeMessage(error instanceof Error ? error.message : '候选翻页失败')
    }
  }, [applyRimeResult])

  const selectRimeSchema = useCallback(async (schemaId: string) => {
    const engine = rimeEngineRef.current
    if (!engine) return

    try {
      applyRimeResult(await engine.selectSchema(schemaId))
      setSelectedSchemaId(schemaId)
      focusPracticeSurface()
    } catch (error) {
      setRimeStatus('error')
      setRimeMessage(error instanceof Error ? error.message : 'Rime 方案切换失败')
    }
  }, [applyRimeResult, focusPracticeSurface])

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing || !currentItem || isFinished) return

    const isKeyboardBridge = event.currentTarget === keyboardBridgeRef.current
    const isPlainTextKey = event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey
    if (isKeyboardBridge && isPlainTextKey) return

    if (event.key === 'Backspace' && !rimeComposition?.preedit && !currentCommittedTextRef.current) {
      event.preventDefault()
      rewindToPreviousItem()
      return
    }

    if (!isRimeReady) {
      event.preventDefault()
      setFeedback('真实 Rime 运行时未就绪，不能开始输入练习')
      return
    }

    if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault()
      void changeRimePage(event.key === 'PageUp')
      return
    }

    const rimeKey = getRimeKeyFromKeyboardEvent(event.nativeEvent)
    if (!rimeKey) return

    event.preventDefault()
    submitRimeKey(rimeKey)
  }, [changeRimePage, currentItem, isFinished, isRimeReady, rewindToPreviousItem, rimeComposition?.preedit, submitRimeKey])

  const handleKeyboardBridgeBeforeInput = useCallback((event: React.FormEvent<HTMLInputElement>) => {
    const nativeEvent = event.nativeEvent as InputEvent
    if (nativeEvent.isComposing) return

    const keys = nativeEvent.inputType === 'deleteContentBackward'
      ? ['{BackSpace}']
      : nativeEvent.inputType === 'deleteContentForward'
        ? ['{Delete}']
        : nativeEvent.inputType === 'insertLineBreak'
          ? ['{Return}']
          : nativeEvent.data
            ? Array.from(nativeEvent.data)
            : []

    if (keys.length === 0) return

    event.preventDefault()
    submitPracticeKeys(keys)
    event.currentTarget.value = ''
  }, [submitPracticeKeys])

  const handleKeyboardBridgeInput = useCallback((event: React.FormEvent<HTMLInputElement>) => {
    const value = event.currentTarget.value
    event.currentTarget.value = ''
    if (!value) return

    submitPracticeKeys(Array.from(value))
  }, [submitPracticeKeys])

  const handlePracticeModeChange = useCallback((enabled: boolean) => {
    clearPendingStudyAutoCommit()
    setStoredPracticeMode(enabled ? 'study' : 'follow')
    setFeedback(null)
    focusPracticeSurface()
  }, [clearPendingStudyAutoCommit, focusPracticeSurface, setStoredPracticeMode])

  const loadPracticeArticles = useCallback(async (forceRefresh = false) => {
    const cachedArticles = readCachedPracticeArticles()
    if (cachedArticles) {
      setArticleOptions(cachedArticles)
      setArticleListMessage(`当前先使用本地缓存的 ${cachedArticles.length} 篇文章`)
    }

    if (isBrowserOffline()) {
      setIsRefreshingArticles(false)
      setArticleListMessage(cachedArticles
        ? `当前离线，使用本地缓存的 ${cachedArticles.length} 篇文章`
        : '当前离线，使用内置长文')
      return
    }

    setIsRefreshingArticles(true)
    setArticleListMessage('正在拉取内置长文和中文维基文库随机长文')

    try {
      const response = await fetch(`/api/practice/articles${forceRefresh ? `?refresh=${Date.now()}` : ''}`, { cache: 'no-store' })
      const data = await response.json() as {
        articles?: PracticeArticleOption[]
        remoteSource?: string | null
        stale?: boolean
        error?: string
      }

      if (!response.ok) {
        throw new Error(data.error ?? 'practice articles request failed')
      }

      const nextArticles = data.articles && data.articles.length > 0
        ? data.articles
        : DEFAULT_PRACTICE_ARTICLE_OPTIONS
      setArticleOptions(nextArticles)
      writeCachedPracticeArticles(nextArticles)
      setArticleListMessage(data.remoteSource
        ? data.stale
          ? `维基文库当前限流，已回退到最近一次联网获取的 ${nextArticles.length} 篇长文`
          : `已载入 ${nextArticles.length} 篇文章，包含中文维基文库随机长文`
        : '联网文章暂时不可用，当前回退到内置长文')
    } catch (error) {
      const fallbackArticles = cachedArticles ?? DEFAULT_PRACTICE_ARTICLE_OPTIONS
      setArticleOptions(fallbackArticles)
      setArticleListMessage(cachedArticles
        ? `联网文章加载失败，继续使用本地缓存的 ${cachedArticles.length} 篇文章`
        : error instanceof Error ? `联网文章加载失败：${error.message}` : '联网文章加载失败，当前回退到内置长文')
    } finally {
      setIsRefreshingArticles(false)
    }
  }, [])

  const applyCustomTextContent = useCallback((rawContent: string, successMessage: string) => {
    const cleanedContent = rawContent.replace(/\r\n/g, '\n').trim()
    if (!cleanedContent) {
      setFeedback('文本内容为空')
      return false
    }

    const contentBytes = getTextByteSize(cleanedContent)
    if (contentBytes > MAX_CUSTOM_TEXT_BYTES) {
      setFeedback(`文本超过 ${formatBytes(MAX_CUSTOM_TEXT_BYTES)}，为避免浏览器解析卡顿，请拆分后再载入`)
      return false
    }

    setPracticeSource('custom')
    setDraftText(cleanedContent)
    setSourceText(cleanedContent)
    setFeedback(successMessage)
    return true
  }, [setPracticeSource])

  const handleTextUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    if (file.size > MAX_CUSTOM_TEXT_BYTES) {
      setFeedback(`.txt 文件超过 ${formatBytes(MAX_CUSTOM_TEXT_BYTES)}，为避免浏览器解析卡顿，请拆分后再上传`)
      return
    }

    const content = await file.text()
    applyCustomTextContent(content, `已载入 ${file.name}`)
  }, [applyCustomTextContent])

  const handleSchemeUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setSchemeStatus('loading')
    setSchemeMessage(`正在解析 ${file.name}`)
    try {
      await loadDictionaryFromZip(file, file.name)
    } catch (error) {
      setSchemeStatus('error')
      setSchemeMessage(error instanceof Error ? error.message : '方案包解析失败')
    }
  }, [loadDictionaryFromZip])

  const handlePracticeSchemeChange = useCallback((keys: 'all' | Set<Key>) => {
    const schemeKey = getSingleSelectionValue(keys)
    if (!isPracticeSchemeKey(schemeKey)) return

    void loadPracticeScheme(schemeKey)
  }, [loadPracticeScheme])

  useEffect(() => {
    if (!hasHydratedPracticeStore) return
    if (didAutoLoadSchemeRef.current) return

    didAutoLoadSchemeRef.current = true
    void loadPracticeScheme(selectedSchemeKey)
  }, [hasHydratedPracticeStore, loadPracticeScheme, selectedSchemeKey])

  useEffect(() => {
    void loadPracticeArticles()
  }, [loadPracticeArticles])

  useEffect(() => {
    if (articleOptions.some((article) => article.id === selectedArticleId)) return
    if (!articleOptions[0]) return
    setSelectedArticleId(articleOptions[0].id)
  }, [articleOptions, selectedArticleId, setSelectedArticleId])

  useEffect(() => {
    let disposed = false

    async function loadKeyTaoConfig() {
      const cachedConfig = readCachedKeyTaoConfig()
      if (cachedConfig && !disposed) {
        setKeytaoConfig(cachedConfig)
      }

      if (isBrowserOffline()) return

      try {
        const response = await fetch('/api/practice/keytao-config')
        if (!response.ok) throw new Error('keytao config request failed')
        const data = await response.json() as KeyTaoConfigData
        writeCachedKeyTaoConfig(data)
        if (!disposed) setKeytaoConfig(data)
      } catch {
        if (!disposed && !cachedConfig) setFeedback('拆分提示加载失败，练习仍可继续')
      }
    }

    void loadKeyTaoConfig()
    return () => {
      disposed = true
    }
  }, [])

  useEffect(() => {
    let disposed = false
    const engine = createLibrimeWasmEngine({
      onStatus(status) {
        if (disposed) return
        setRimeStatus('checking')
        setRimeMessage(status.message)
        if (status.detail) setRimeDetail(status.detail)
        if (typeof status.progress === 'number') setRimeProgress(status.progress)
      },
    })
    rimeEngineRef.current = engine

    async function initEngine() {
      setRimeStatus('checking')
      setRimeMessage('正在检查浏览器 librime wasm 运行时')
      setRimeDetail('读取 /librime-wasm/manifest.json')
      setRimeProgress(10)

      try {
        const manifest = await engine.loadManifest()
        if (!manifest.available) {
          if (!disposed) {
            setRimeStatus('unavailable')
            setRimeMessage('真实 Rime 运行时未启用，输入练习暂停')
            setRimeDetail(formatRimeRuntimeReason(manifest.reason))
            setRimeProgress(100)
          }
          return
        }

        setRimeMessage('正在启动浏览器 librime')
        setRimeDetail('加载 worker.js、rime.js、rime.wasm 和 rime.data')
        setRimeProgress(35)
        await engine.init()

        setRimeDetail('读取内置 schema 列表')
        setRimeProgress(55)
        const schemas = await engine.listSchemas()
        if (schemas[0]) await engine.selectSchema(schemas[0].id)
        if (disposed) return

        setRimeSchemas(schemas)
        setSelectedSchemaId(schemas[0]?.id ?? null)
        setRimeStatus('ready')
        setRimeProgress(65)
        setRimeDetail(schemas.length > 0 ? `${schemas.length} 个内置方案可用` : '运行时已启动，等待部署 KeyTao 方案')
        setRimeMessage(schemas.length > 0
          ? `已加载浏览器 librime wasm，可切换 ${schemas.length} 个方案`
          : '已加载浏览器 librime wasm')
      } catch (error) {
        if (disposed) return
        setRimeStatus('unavailable')
        setRimeMessage('真实 Rime 运行时未启用，输入练习暂停')
        setRimeDetail(error instanceof Error
          ? `Rime WASM 初始化失败：${error.message}`
          : 'Rime WASM 初始化失败，请检查 rime.js/rime.wasm 是否匹配 worker 适配层')
        setRimeProgress(100)
      }
    }

    void initEngine()

    return () => {
      disposed = true
      engine.dispose()
      if (rimeEngineRef.current === engine) rimeEngineRef.current = null
    }
  }, [deployRimeFiles])

  useEffect(() => {
    if (rimeStatus !== 'ready' || !pendingRimeDeployRequest) return
    if (deployedRimeDeployIdRef.current >= pendingRimeDeployRequest.id) return
    if (pendingRimeDeployFilesRef.current.length === 0) return

    deployedRimeDeployIdRef.current = pendingRimeDeployRequest.id
    void deployRimeFiles(pendingRimeDeployFilesRef.current, pendingRimeDeployRequest.sourceName).catch((error) => {
      deployedRimeDeployIdRef.current = 0
      setRimeStatus('error')
      setRimeMessage('KeyTao Rime 方案部署失败')
      setRimeDetail(error instanceof Error ? error.message : 'librime deploy 返回未知错误')
      setRimeProgress(100)
    })
  }, [deployRimeFiles, pendingRimeDeployRequest, rimeStatus])

  useEffect(() => {
    resetSession()
  }, [practiceKey, resetSession])

  useEffect(() => {
    if (!startTime || isFinished) return

    const timer = window.setInterval(() => {
      setElapsedMs(Date.now() - startTime)
    }, 500)

    return () => window.clearInterval(timer)
  }, [isFinished, startTime])

  useEffect(() => () => {
    if (pendingStudyAutoCommitTimerRef.current !== null) {
      window.clearTimeout(pendingStudyAutoCommitTimerRef.current)
    }
  }, [])

  useEffect(() => {
    focusPracticeSurface()
  }, [currentIndex, focusPracticeSurface, schemeStatus])

  return (
    <div className="min-h-screen bg-default-50/60">
      <main className="mx-auto flex max-w-375 flex-col gap-4 px-4 pt-3 pb-6 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-1.5">
          <div className="rounded-small border border-default-200 bg-content1 px-4 py-3 shadow-sm">
            <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="hidden rounded-small border border-primary-200 bg-primary-50 p-2.5 text-primary sm:block dark:bg-primary-50/10">
                  <Keyboard className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-end gap-x-3 gap-y-1">
                    <h1 className="shrink-0 text-2xl font-bold leading-none tracking-normal sm:text-[2rem]">键道练习</h1>
                    <span className="text-sm font-medium text-default-500 sm:text-base">天地立心，以键为道！</span>
                    <Button
                      size="sm"
                      variant="flat"
                      startContent={<Coffee className="h-4 w-4" />}
                      aria-label="赞助键道开发"
                      as={Link}
                      href="/sponsor"
                      className="text-pink-600 dark:text-pink-400"
                    >
                      赞助
                    </Button>
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-2 lg:items-end">
                <div className="flex flex-wrap items-center gap-2 md:justify-end lg:flex-nowrap">
                  <div className="w-42 min-w-42">
                    <Select
                      aria-label="载入文章"
                      placeholder="载入文章"
                      size="sm"
                      disallowEmptySelection
                      selectedKeys={[practiceSource]}
                      onSelectionChange={(keys) => {
                        const nextSource = getSingleSelectionValue(keys)
                        if (!nextSource) return
                        setPracticeSource(nextSource as PracticeSource)
                      }}
                      classNames={{
                        trigger: 'h-9 min-h-9',
                        value: 'text-small font-medium',
                      }}
                    >
                      {PRACTICE_SOURCE_OPTIONS.map((option) => (
                        <SelectItem key={option.key} textValue={option.label}>{option.label}</SelectItem>
                      ))}
                    </Select>
                  </div>
                  {practiceSource === 'article' && (
                    <div className="w-42 min-w-42">
                      <Select
                        aria-label="文章内容"
                        placeholder="选择文章"
                        size="sm"
                        disallowEmptySelection
                        selectedKeys={[selectedArticleId]}
                        onSelectionChange={(keys) => {
                          const nextArticleId = getSingleSelectionValue(keys)
                          if (!nextArticleId) return
                          setSelectedArticleId(nextArticleId)
                        }}
                        classNames={{
                          trigger: 'h-9 min-h-9',
                          value: 'text-small font-medium',
                        }}
                      >
                        {articleOptions.map((article) => (
                          <SelectItem key={article.id} textValue={article.title}>
                            {article.detail ? `${article.title} · ${article.detail}` : article.title}
                          </SelectItem>
                        ))}
                      </Select>
                    </div>
                  )}
                  <div className="w-38 min-w-38">
                    <Select
                      aria-label="方案"
                      placeholder="选择方案"
                      size="sm"
                      disallowEmptySelection
                      selectedKeys={[selectedSchemeKey]}
                      onSelectionChange={handlePracticeSchemeChange}
                      classNames={{
                        trigger: 'h-9 min-h-9',
                        value: 'text-small font-medium',
                      }}
                    >
                      {PRACTICE_SCHEME_OPTIONS.map((scheme) => (
                        <SelectItem key={scheme.key} textValue={scheme.label}>{scheme.label}</SelectItem>
                      ))}
                    </Select>
                  </div>
                  <Tooltip content={selectedSchemeKey === 'keydo' ? `下载 ${selectedScheme.label} pre-release 方案` : `下载 latest ${selectedScheme.label} 方案`}>
                    <Button
                      size="sm"
                      color="primary"
                      variant="flat"
                      startContent={<Download className="h-4 w-4" />}
                      isLoading={schemeStatus === 'loading'}
                      onPress={() => loadPracticeScheme(selectedSchemeKey)}
                    >
                      下载方案
                    </Button>
                  </Tooltip>
                  <Button size="sm" variant="flat" startContent={<Upload className="h-4 w-4" />} onPress={() => schemeUploadRef.current?.click()}>
                    上传方案
                  </Button>
                  <Button size="sm" variant="flat" isIconOnly aria-label="重置练习" onPress={resetSession}>
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                </div>
                {schemeStatus === 'loading' && (
                  <div className="text-right text-tiny text-default-500 lg:max-w-120">
                    加载需要等待，如有梯子请打开可加速。
                  </div>
                )}
                {practiceSource === 'custom' && (
                  <div className="w-full rounded-small border border-default-200 bg-default-50/70 p-2.5 lg:max-w-120">
                    <div className="flex flex-col gap-3">
                      <Textarea
                        minRows={2}
                        value={draftText}
                        onValueChange={setDraftText}
                        placeholder="粘贴或上传 .txt 练习内容"
                        classNames={{ input: 'text-small leading-6' }}
                      />
                      <div className="text-tiny text-default-500">
                        自定义文本上限 {formatBytes(MAX_CUSTOM_TEXT_BYTES)}，超出后请拆分成多个 .txt。
                      </div>
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          variant="flat"
                          startContent={<FileText className="h-4 w-4" />}
                          onPress={() => textUploadRef.current?.click()}
                        >
                          上传文本
                        </Button>
                        <Button
                          color="primary"
                          variant="flat"
                          onPress={() => {
                            applyCustomTextContent(draftText, '已应用自定义文本')
                          }}
                        >
                          应用文本
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <input ref={textUploadRef} type="file" accept=".txt,text/plain" className="hidden" onChange={handleTextUpload} />
          <input ref={schemeUploadRef} type="file" accept=".zip,application/zip" className="hidden" onChange={handleSchemeUpload} />

          <div className="grid min-w-0 gap-1.5 md:grid-cols-2">
            <Alert
              hideIcon
              color={schemeStatus === 'error' ? 'danger' : schemeStatus === 'ready' ? 'success' : 'primary'}
              variant="flat"
              className="min-w-0 w-full overflow-hidden"
              classNames={{
                base: 'min-h-0 px-3 py-2',
                mainWrapper: 'gap-1',
              }}
            >
              <div className="flex w-full flex-col gap-1.5">
                <div className="flex min-w-0 w-full items-center gap-2 overflow-x-auto whitespace-nowrap text-[12px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <span className="shrink-0 font-medium text-default-500">方案：</span>
                  <span className="shrink-0 font-semibold">{schemeStatusLabel}</span>
                  {schemeStatus === 'loading' && schemeDownloadProgress !== null && (
                    <Progress
                      aria-label="方案下载进度"
                      value={schemeDownloadProgress}
                      color="primary"
                      size="sm"
                      className="w-28 shrink-0"
                    />
                  )}
                  <span className="shrink-0 text-default-500">{schemeDetailLabel}</span>
                </div>
                {selectedSchemeCachedVersions.length > 0 && (
                  <div className="flex flex-col gap-1.5 text-[12px] sm:flex-row sm:flex-wrap sm:items-center">
                    <span className="shrink-0 text-default-500">本地方案</span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {selectedSchemeCachedVersions.map((version) => (
                        <div key={`${version.schemeKey}-${version.version}`} className="inline-flex h-7 min-w-0 items-center gap-1 rounded-small border border-default-200 bg-content1 px-1.5 text-[11px]">
                          <Button
                            size="sm"
                            variant="light"
                            className="h-5 min-h-5 min-w-0 px-1 text-[11px] font-medium text-primary"
                            onPress={() => void loadCachedPracticeScheme(version)}
                          >
                            {version.version}
                          </Button>
                          <Button
                            size="sm"
                            variant="light"
                            isIconOnly
                            aria-label={`删除 ${version.label} ${version.version}`}
                            className="h-5 min-h-5 min-w-5"
                            onPress={() => void deleteCachedPracticeScheme(version)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </Alert>

            {showRimeStatus && (
              <Alert
                hideIcon
                color={rimeStatus === 'ready' ? 'success' : rimeStatus === 'checking' ? 'primary' : 'warning'}
                variant="flat"
                className="min-w-0 w-full overflow-hidden"
                classNames={{
                  base: 'min-h-0 px-3 py-2',
                  mainWrapper: 'gap-1',
                }}
              >
                <div className="flex min-w-0 w-full flex-col gap-1">
                  <div className="flex min-w-0 w-full items-start justify-between gap-2 sm:items-center">
                    <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto whitespace-nowrap text-[12px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:overflow-hidden">
                      <span className="shrink-0 font-medium text-default-500">Rime引擎：</span>
                      <span className="shrink-0 font-semibold">{rimeStatusLabel}</span>
                      {rimeStatus === 'checking' && (
                        <Progress aria-label="Rime 启动进度" value={rimeProgress} color="primary" size="sm" className="w-24 shrink-0" />
                      )}
                      <span className="hidden min-w-0 truncate text-[11px] text-default-500 sm:inline">{rimeDetailLabel}</span>
                    </div>
                    {isRimeReady && rimeSchemas.length > 0 && (
                      <div className="w-38 min-w-38 shrink-0 sm:w-40 sm:min-w-40">
                        <Select
                          aria-label="Rime 方案列表"
                          placeholder="选择方案"
                          labelPlacement="outside-left"
                          label="方案切换"
                          size="sm"
                          disallowEmptySelection
                          selectedKeys={selectedSchemaId ? [selectedSchemaId] : []}
                          onSelectionChange={(keys) => {
                            const nextSchemaId = getSingleSelectionValue(keys)
                            if (!nextSchemaId) return
                            void selectRimeSchema(nextSchemaId)
                          }}
                          classNames={{
                            base: 'w-full',
                            trigger: 'h-8 min-h-8 bg-content1',
                            value: 'text-[12px] font-medium',
                          }}
                        >
                          {rimeSchemas.map((schema) => (
                            <SelectItem key={schema.id} textValue={schema.name}>{schema.name}</SelectItem>
                          ))}
                        </Select>
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 text-[11px] leading-tight text-default-500 sm:hidden">{rimeDetailLabel}</div>
                </div>
              </Alert>
            )}
          </div>
        </div>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex flex-col gap-4">
            <Card
              radius="sm"
              shadow="sm"
              onPointerDown={(event) => {
                const target = event.target as HTMLElement
                if (target.closest('button,[role="tab"],select,textarea,input')) return
                focusPracticeSurface()
              }}
              className={`border transition-colors ${isPracticeFocused ? 'border-primary bg-content1' : 'border-default-200 bg-content1'}`}
              style={{ height: 'min(42rem, calc(100vh - 16rem))' }}
            >
              <CardBody ref={cardBodyRef} className="relative flex h-full flex-col overflow-hidden p-0">
                <input
                  ref={keyboardBridgeRef}
                  type="text"
                  inputMode="text"
                  autoCapitalize="none"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-label="键道移动端输入桥"
                  tabIndex={-1}
                  className="pointer-events-none absolute left-4 top-4 h-11 w-11 opacity-0"
                  onFocus={() => setIsPracticeFocused(true)}
                  onBlur={() => setIsPracticeFocused(false)}
                  onKeyDown={handleKeyDown}
                  onBeforeInput={handleKeyboardBridgeBeforeInput}
                  onInput={handleKeyboardBridgeInput}
                />
                <div className="shrink-0 flex flex-col gap-3 border-b border-divider px-5 py-4 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-center gap-2 text-small text-default-500">
                    <Sparkles className="h-4 w-4 text-primary" />
                    <span>{PRACTICE_SOURCE_OPTIONS.find((item) => item.key === practiceSource)?.label}</span>
                    {practiceSource === 'article' && selectedArticle ? <span className="truncate text-default-400">· {selectedArticle.title}</span> : null}
                    <span>·</span>
                    <span>{practiceItems.length.toLocaleString()} 项</span>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <Switch
                      size="sm"
                      isSelected={isStudyMode}
                      onValueChange={handlePracticeModeChange}
                    >
                      学习模式
                    </Switch>
                    <Button
                      size="sm"
                      variant={practiceShuffleSeed > 0 ? 'flat' : 'light'}
                      color={practiceShuffleSeed > 0 ? 'primary' : 'default'}
                      startContent={<Shuffle className="h-4 w-4" />}
                      onPress={() => setPracticeShuffleSeed((value) => (value > 0 ? 0 : 1))}
                      isDisabled={practiceItems.length < 2 || isFinished}
                    >
                      {practiceShuffleSeed > 0 ? '已乱序' : '乱序'}
                    </Button>
                    <Button size="sm" variant="light" startContent={<SkipForward className="h-4 w-4" />} onPress={skipCurrentItem} isDisabled={!currentItem || isFinished}>
                      跳过
                    </Button>
                    <Button size="sm" variant="light" isIconOnly aria-label="重置练习" onPress={resetSession}>
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {practiceSource === 'article' && (
                  <div className="flex items-center justify-between gap-3 border-b border-divider px-5 py-2 text-[12px] text-default-500">
                    <span className="min-w-0 flex-1">{articleListMessage}</span>
                    <Button
                      size="sm"
                      variant="light"
                      startContent={<RotateCcw className="h-3.5 w-3.5" />}
                      isLoading={isRefreshingArticles}
                      onPress={() => {
                        void loadPracticeArticles(true)
                      }}
                    >
                      刷新文章
                    </Button>
                  </div>
                )}

                <div
                  ref={inputSurfaceRef}
                  tabIndex={0}
                  role="textbox"
                  aria-label="键道练习输入区"
                  onFocus={() => setIsPracticeFocused(true)}
                  onBlur={() => setIsPracticeFocused(false)}
                  onKeyDown={handleKeyDown}
                  onPointerDown={focusPracticeSurface}
                  onClick={focusPracticeSurface}
                  className={`min-h-0 flex-1 cursor-text overflow-y-auto px-5 pb-36 pt-8 outline-none transition-colors sm:px-8 ${isPracticeFocused ? 'focus-visible:ring-2 focus-visible:ring-primary/60' : 'opacity-85'}`}
                >
                  {isStudyMode ? (
                    <div className="grid min-h-full grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_auto_minmax(0,1fr)_minmax(0,0.8fr)] items-center gap-4 text-center font-mono">
                      {previousPreviewItems.map((item, index) => {
                        const isNearItem = index === previousPreviewItems.length - 1
                        return (
                          <div key={`previous-preview-${index}`} className="min-w-0 text-left">
                            {item ? (
                              <div className={`truncate leading-none text-default-400 ${isNearItem
                                ? 'text-[clamp(1.75rem,4vw,3rem)] opacity-80'
                                : 'text-[clamp(1rem,2.4vw,1.65rem)] opacity-35'}`}>{item.text}</div>
                            ) : <div className="text-default-300">&nbsp;</div>}
                          </div>
                        )
                      })}
                      {currentItem && !isFinished ? (
                        <div className="flex flex-col items-center gap-3">
                          <div className="text-small text-default-500">{currentIndex + 1} / {practiceItems.length}</div>
                          <div ref={(node) => { currentTargetAnchorRef.current = node }} className="text-[clamp(3.5rem,9vw,7rem)] font-semibold leading-none tracking-normal text-foreground">{currentItem.text}</div>
                        </div>
                      ) : isPracticeLoading ? (
                        <div className="flex flex-col items-center gap-3">
                          <Spinner size="lg" color="primary" />
                          <div className="text-small text-default-500">加载练习内容中</div>
                        </div>
                      ) : isPracticeEmpty ? (
                        <div className="text-small text-default-500">暂无可练习内容</div>
                      ) : (
                        <span className="font-semibold text-success">完成</span>
                      )}
                      {nextPreviewItems.map((item, index) => {
                        const isNearItem = index === 0
                        return (
                          <div key={`next-preview-${index}`} className="min-w-0 text-right">
                            {item ? (
                              <div className={`truncate leading-none text-default-400 ${isNearItem
                                ? 'text-[clamp(1.75rem,4vw,3rem)] opacity-80'
                                : 'text-[clamp(1rem,2.4vw,1.65rem)] opacity-35'}`}>{item.text}</div>
                            ) : <div className="text-default-300">&nbsp;</div>}
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="font-mono text-3xl leading-relaxed tracking-normal whitespace-normal break-normal sm:text-4xl">
                      {hasPracticeItems ? (
                        practiceItems.map((item, index) => {
                          const tone = index < currentIndex ? 'done' : index === currentIndex && !isFinished ? 'current' : 'pending'
                          const overlaySegments = index >= currentIndex ? followRenderedSegments[index - currentIndex] : null
                          return (
                            <FollowPracticeTextItem
                              key={`${item.text}-${index}`}
                              text={item.text}
                              itemIndex={index}
                              tone={tone}
                              overlaySegments={overlaySegments}
                              showInputError={tone === 'current' && hasInputError}
                              setCurrentTargetAnchor={setCurrentTargetAnchor}
                            />
                          )
                        })
                      ) : isPracticeLoading ? (
                        <div className="flex min-h-full flex-col items-center justify-center gap-3 py-12 text-base text-default-500">
                          <Spinner size="lg" color="primary" />
                          <span>加载练习内容中</span>
                        </div>
                      ) : isPracticeEmpty ? (
                        <div className="py-12 text-center text-base text-default-500">暂无可练习内容</div>
                      ) : (
                        <span className="font-semibold text-success">完成</span>
                      )}
                    </div>
                  )}
                </div>

                {isPracticeFocused && currentItem && !isFinished && (
                  <div
                    ref={candidatePanelRef}
                    className={`${isTouchLayout
                      ? 'fixed left-3 right-3 z-60 overflow-hidden rounded-large border bg-content1/95 shadow-2xl backdrop-blur sm:left-4 sm:right-4'
                      : 'fixed z-60 w-max overflow-hidden rounded-large border bg-content1/95 shadow-2xl backdrop-blur'} ${hasInputError ? 'border-danger' : 'border-primary/40'}`}
                    style={isTouchLayout
                      ? mobileCandidateOverlayTop === null
                        ? { bottom: 'calc(env(safe-area-inset-bottom) + 0.75rem)' }
                        : { top: `${mobileCandidateOverlayTop}px` }
                      : !candidateOverlayStyle
                        ? undefined
                        : {
                          top: `${candidateOverlayStyle.top}px`,
                          left: `${candidateOverlayStyle.left}px`,
                          maxWidth: `${candidateOverlayStyle.maxWidth}px`,
                        }}
                  >
                    <div className={`flex items-center gap-3 border-b px-4 py-3 ${hasInputError ? 'border-danger/30 bg-danger-50 dark:bg-danger-50/10' : 'border-divider bg-default-100/80'}`}>
                      <span className={`min-h-7 max-w-full truncate font-mono text-xl ${hasInputError ? 'text-danger' : 'text-primary'}`}>
                        {displayedInput || <span className="text-default-300">_</span>}
                      </span>
                      {hasInputError && (
                        <span className="inline-flex items-center gap-1 text-small text-danger">
                          <AlertTriangle className="h-4 w-4 shrink-0" />
                          {feedback}
                        </span>
                      )}
                    </div>
                    <div className={`flex min-h-16 items-center justify-start gap-2 overflow-hidden px-3 py-3 ${isTouchLayout ? 'flex-wrap' : 'flex-nowrap'}`}>
                      {displayedCandidateItems.length > 0 ? displayedCandidateItems.map(({ candidate, index, candidateHint, isValidTarget, isExactTarget }) => {
                        return (
                          <button
                            key={`${candidate.text}-${candidateHint ?? ''}-${index}`}
                            type="button"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                              void selectRimeCandidate(index)
                              focusPracticeSurface()
                            }}
                            className={`inline-flex max-w-full items-center gap-2 rounded-small border px-3 py-2 text-small transition-colors ${isExactTarget
                              ? 'border-success bg-success text-success-foreground'
                              : isValidTarget
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-divider bg-content1 text-foreground hover:bg-default-100'}`}
                          >
                            <span className="shrink-0 font-mono text-tiny opacity-70">{getCandidateLabel(index)}</span>
                            <span className="min-w-0 max-w-[min(18rem,62vw)] truncate text-base leading-none md:max-w-none">{candidate.text}</span>
                            {candidateHint && <span className="min-w-0 max-w-24 truncate font-mono text-tiny opacity-60 md:max-w-none">{candidateHint}</span>}
                          </button>
                        )
                      }) : (
                        <div className="px-1 text-small text-default-400">
                          {isRimeReady ? displayedInput ? '无候选' : '等待输入' : '等待真实 Rime 运行时'}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </CardBody>
            </Card>

            <Card radius="sm" shadow="sm" className="border border-divider">
              <CardBody className="gap-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Layers className="h-4 w-4 text-primary" />
                    <h2 className="text-lg font-semibold">键道图谱</h2>
                  </div>
                  <Button
                    size="sm"
                    variant="flat"
                    startContent={isKeyMapVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    onPress={() => setIsKeyMapVisible((value) => !value)}
                  >
                    {isKeyMapVisible ? '隐藏' : '查看'}
                  </Button>
                </div>
                <KeyTaoGraph visible={isKeyMapVisible} schemeKey={selectedSchemeKey} />
              </CardBody>
            </Card>
          </div>

          <div className="flex flex-col gap-4">
            <Card radius="sm" shadow="sm" className="border border-divider">
              <CardBody className="gap-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Info className="h-4 w-4 text-primary" />
                    <h2 className="text-lg font-semibold">提示</h2>
                  </div>
                  <Button
                    size="sm"
                    variant="flat"
                    startContent={isInsightPanelVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    onPress={() => setIsInsightPanelVisible((value) => !value)}
                  >
                    {isInsightPanelVisible ? '隐藏' : '查看'}
                  </Button>
                </div>
                {isInsightPanelVisible && (
                  <InsightPanel title="当前目标" insight={currentInsight} />
                )}
              </CardBody>
            </Card>

            <Card radius="sm" shadow="sm" className="border border-divider">
              <CardBody className="gap-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">统计</h2>
                </div>
                <Progress aria-label="练习进度" value={progressValue} color="primary" size="sm" />
                <div className="grid grid-cols-2 gap-3 text-small">
                  <div className="rounded-small bg-default-100 px-3 py-2">
                    <div className="text-default-500">速度</div>
                    <div className="font-mono text-lg font-semibold">{speedDecimal}</div>
                  </div>
                  <div className="rounded-small bg-default-100 px-3 py-2">
                    <div className="text-default-500">击键</div>
                    <div className="font-mono text-lg font-semibold">{keystrokesPerChar}</div>
                  </div>
                  <div className="rounded-small bg-default-100 px-3 py-2">
                    <div className="text-default-500">码长</div>
                    <div className="font-mono text-lg font-semibold">{avgCodeLength}</div>
                  </div>
                  <div className="rounded-small bg-default-100 px-3 py-2">
                    <div className="text-default-500">字数</div>
                    <div className="font-mono text-lg font-semibold">{completedText.length}</div>
                  </div>
                  <div className="rounded-small bg-default-100 px-3 py-2">
                    <div className="text-default-500">错字</div>
                    <div className="font-mono text-lg font-semibold">{wrongItems}</div>
                  </div>
                  <div className="rounded-small bg-default-100 px-3 py-2">
                    <div className="text-default-500">用时</div>
                    <div className="font-mono text-lg font-semibold">{formatElapsed(elapsedMs)}</div>
                  </div>
                  <div className="col-span-2 rounded-small bg-default-100 px-3 py-2">
                    <div className="text-default-500">键准</div>
                    <div className="font-mono text-lg font-semibold">{keyAccuracy}%</div>
                  </div>
                </div>
              </CardBody>
            </Card>

            <Card radius="sm" shadow="sm" className="border border-divider">
              <CardBody className="gap-3">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold">飞键规则</h2>
                  <Button
                    size="sm"
                    variant="flat"
                    startContent={isFlyRulePanelVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    onPress={() => setIsFlyRulePanelVisible((value) => !value)}
                  >
                    {isFlyRulePanelVisible ? '隐藏' : '查看'}
                  </Button>
                </div>
                {isFlyRulePanelVisible && (
                  <div className="grid gap-2">
                    {FLY_RULE_SUMMARY.map((rule) => (
                      <div key={rule.id} className="rounded-small border border-default-200 bg-default-50/70 px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold">{rule.head}</span>
                          <span className="font-mono text-primary">{rule.keyName}</span>
                        </div>
                        <div className="mt-1 text-tiny leading-5 text-default-500">{rule.finals}</div>
                        {rule.fly && <div className="text-tiny text-warning-600">{rule.fly}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>

          </div>
        </section>
      </main>
    </div>
  )
}
