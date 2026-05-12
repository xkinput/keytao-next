'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import JSZip from 'jszip'
import { pinyin } from 'pinyin-pro'
import {
  Alert,
  Button,
  Card,
  CardBody,
  Chip,
  Progress,
  Tab,
  Tabs,
  Textarea,
  Tooltip,
} from '@heroui/react'
import {
  AlertTriangle,
  Download,
  Eye,
  EyeOff,
  FileText,
  Info,
  Keyboard,
  Layers,
  RotateCcw,
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
import {
  deleteCachedPracticeSchemeZip,
  getCachedPracticeSchemeZip,
  putCachedPracticeSchemeZip,
  type CachedPracticeSchemeVersion,
} from '@/lib/services/practiceSchemeCache'
import { usePracticeStore, type PracticeSchemeKey } from '@/lib/store/practice'

const DEFAULT_PRACTICE_TEXT = '我们可以通过键道练习输入文字词组编码方案系统开源词库用户学习效率中文输入法'
const EMPTY_RIME_CANDIDATES: RimeComposition['candidates'] = []
const COMMON_SINGLE_CHARACTER_ORDER = '的一是在不了有和人这中大为上个国我以要他时来用们生到作地于出就分对成会可主发年动同工也能下过子说产种面而方后多定行学法所民得经十三之进着等部度家电力里如水化高自二理起小物现实加量都两体制机当使点从业本去把性好应开它合还因由其些然前外天政四日那社义事平形相全表间样与关各重新线内数正心反你明看原又么利比或但质气第向道命此变条只没结解问意建月公无系军很情者最立代想已通并提直题党程展五果料象员革位入常文总次品式活设及管特件长求老头基资边流路级少图山统接知较将组见计别她手角期根论运农指几九区强放决西被干做必战先回则任取据处队南给色光门即保治北造百规热领七海口东导器压志世金增争济阶油思术极交受联什认六共权收证改清己美再采转更单风切打白教速花带安场身车例真务具万每目至达走积示议声报斗完类八离华名确才科张信马节话米整空元况今集温传土许步群广石记需段研界拉林律叫且究观越织装影算低持音众书布复容儿须际商非验连断深难近矿千周委素技备半办青省列习响约支般史感劳便团往酸历市克何除消构府称太准精值号率族维划选标写存候毛亲快效斯院查江型眼王按格养易置派层片始却专状育厂京识适属圆包火住调满县局照参红细引听该铁价严龙飞'
const COMMON_CHARACTER_RANK = new Map(Array.from(COMMON_SINGLE_CHARACTER_ORDER).map((char, index) => [char, index]))

type SchemeStatus = 'idle' | 'loading' | 'ready' | 'error'
type PracticeSource = 'common500' | 'common1000' | 'article' | 'custom' | 'flyKey'
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
  { key: 'keydo', label: '键道·我流', asset: 'main.zip' },
]

function isPracticeSchemeKey(value: string | null): value is PracticeSchemeKey {
  return value === 'keytao' || value === 'xmjd' || value === 'txjx' || value === 'keydo'
}

const ARTICLE_OPTIONS = [
  {
    id: 'morning-note',
    title: '清晨短文',
    text: '清晨的风从窗外经过，桌上的字帖安静展开。我们把每一次按键都放慢一点，先看准声韵，再确认拆分。练习不是追赶速度，而是让手指记住正确的路。',
  },
  {
    id: 'winter-sea',
    title: '海边冬夜',
    text: '冬夜的海很安静，远处的灯像细小的星。人坐在窗前读书，偶尔听见潮声，便知道时间还在慢慢向前。字与词也一样，熟悉以后自然会连成句子。',
  },
  {
    id: 'typing-essay',
    title: '常用打字文章',
    text: '中文输入练习需要稳定、清楚、连续的材料。短句可以训练节奏，长句可以训练耐心，常用字则帮助我们减少犹豫。每天完成一小段，编码就会逐渐变成直觉。',
  },
]

const PRACTICE_SOURCE_OPTIONS: Array<{ key: PracticeSource; label: string; detail: string }> = [
  { key: 'common500', label: '单字常用字前500', detail: '高频单字' },
  { key: 'common1000', label: '单字常用字前1000', detail: '扩展高频' },
  { key: 'article', label: '文章', detail: '下拉选择' },
  { key: 'flyKey', label: '键道飞键练习', detail: 'zh/ch/uang' },
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
    .map((entry) => ({ text: entry.text, codes: [entry.code] }))
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
    const charPinyin = getPinyinForChar(char)
    const { initial, final } = parsePinyinSyllable(charPinyin)
    const split = config.splitMap[char]
    const shapeCode = split
      ? `${encodeComponent(split.c1, config.rootMap)}${encodeComponent(split.c2, config.rootMap)}`
      : undefined

    return {
      char,
      pinyin: charPinyin,
      phoneticCode: encodePhoneticCode(initial, final),
      split,
      shapeCode,
      codes: charCodes,
      flyHints: getFlyKeyHints(initial, final),
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

function KeyTaoGraph({ visible }: { visible: boolean }) {
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

export default function KeyTaoPracticePage() {
  const inputSurfaceRef = useRef<HTMLDivElement>(null)
  const textUploadRef = useRef<HTMLInputElement>(null)
  const schemeUploadRef = useRef<HTMLInputElement>(null)
  const rimeEngineRef = useRef<LibrimeWasmEngine | null>(null)
  const pendingRimeDeployFilesRef = useRef<RimeDeployFile[]>([])
  const nextRimeDeployIdRef = useRef(0)
  const deployedRimeDeployIdRef = useRef(0)
  const activeSchemeDownloadIdRef = useRef(0)
  const didAutoLoadSchemeRef = useRef(false)

  const selectedSchemeKey = usePracticeStore((state) => state.selectedSchemeKey)
  const cachedSchemeVersions = usePracticeStore((state) => state.cachedSchemeVersions)
  const hasHydratedPracticeStore = usePracticeStore((state) => state.hasHydrated)
  const setSelectedSchemeKey = usePracticeStore((state) => state.setSelectedSchemeKey)
  const upsertCachedSchemeVersion = usePracticeStore((state) => state.upsertCachedSchemeVersion)
  const removeCachedSchemeVersion = usePracticeStore((state) => state.removeCachedSchemeVersion)

  const [dictionary, setDictionary] = useState<PracticeDictionary | null>(null)
  const [schemeStatus, setSchemeStatus] = useState<SchemeStatus>('idle')
  const [schemeMessage, setSchemeMessage] = useState('等待加载键道方案')
  const [schemeDownloadProgress, setSchemeDownloadProgress] = useState<number | null>(null)
  const [practiceSource, setPracticeSource] = useState<PracticeSource>('common500')
  const [selectedArticleId, setSelectedArticleId] = useState(ARTICLE_OPTIONS[0].id)
  const [sourceText, setSourceText] = useState(DEFAULT_PRACTICE_TEXT)
  const [draftText, setDraftText] = useState(DEFAULT_PRACTICE_TEXT)
  const [keytaoConfig, setKeytaoConfig] = useState<KeyTaoConfigData | null>(null)
  const [isKeyMapVisible, setIsKeyMapVisible] = useState(true)
  const [lastCompletedTarget, setLastCompletedTarget] = useState<string | null>(null)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [completedText, setCompletedText] = useState('')
  const [totalKeys, setTotalKeys] = useState(0)
  const [wrongKeys, setWrongKeys] = useState(0)
  const [perfectItems, setPerfectItems] = useState(0)
  const [itemHadMistake, setItemHadMistake] = useState(false)
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
  const rimeStatusRef = useRef(rimeStatus)
  const selectedSchemaIdRef = useRef(selectedSchemaId)

  const selectedArticle = useMemo(
    () => ARTICLE_OPTIONS.find((article) => article.id === selectedArticleId) ?? ARTICLE_OPTIONS[0],
    [selectedArticleId]
  )
  const selectedScheme = useMemo(
    () => PRACTICE_SCHEME_OPTIONS.find((scheme) => scheme.key === selectedSchemeKey) ?? PRACTICE_SCHEME_OPTIONS[0],
    [selectedSchemeKey]
  )
  const selectedSchemeCachedVersions = cachedSchemeVersions[selectedSchemeKey] ?? []

  const practiceItems = useMemo(() => {
    if (!dictionary) return []
    if (practiceSource === 'common500') return createSingleCharacterItems(dictionary, 500)
    if (practiceSource === 'common1000') return createSingleCharacterItems(dictionary, 1000)
    if (practiceSource === 'flyKey') {
      return createSingleCharacterItems(dictionary, 1000, (entry) => {
        const charPinyin = getPinyinForChar(entry.text)
        const { initial, final } = parsePinyinSyllable(charPinyin)
        return getFlyKeyHints(initial, final).length > 0
      })
    }
    const content = practiceSource === 'article' ? selectedArticle.text : sourceText
    return createPracticeItemsFromText(content, dictionary, Number.MAX_SAFE_INTEGER)
  }, [dictionary, practiceSource, selectedArticle.text, sourceText])

  const currentItem = practiceItems[currentIndex]
  const currentInsight = useMemo(
    () => buildPracticeInsight(currentItem?.text, dictionary, keytaoConfig),
    [currentItem?.text, dictionary, keytaoConfig]
  )

  const lastCompletedInsight = useMemo(
    () => buildPracticeInsight(lastCompletedTarget ?? undefined, dictionary, keytaoConfig),
    [dictionary, keytaoConfig, lastCompletedTarget]
  )
  const isRimeReady = rimeStatus === 'ready' && Boolean(rimeEngineRef.current)
  const displayedInput = rimeComposition?.preedit ?? ''
  const displayedCandidates = rimeComposition?.candidates ?? EMPTY_RIME_CANDIDATES
  const hasInputError = feedback?.startsWith('当前输入')
    || feedback?.startsWith('已选')
    || feedback?.startsWith('输入法提交')
    || feedback?.startsWith('真实 Rime')
    || false
  const showRimeStatus = true

  const practiceKey = useMemo(
    () => practiceItems.map((item) => item.text).join('|'),
    [practiceItems]
  )

  const progressValue = practiceItems.length > 0
    ? Math.round((currentIndex / practiceItems.length) * 100)
    : 0
  const accuracy = totalKeys > 0 ? Math.max(0, Math.round(((totalKeys - wrongKeys) / totalKeys) * 100)) : 100
  const speed = elapsedMs > 0 ? Math.round((completedText.length / (elapsedMs / 60000))) : 0
  const isFinished = practiceItems.length > 0 && currentIndex >= practiceItems.length

  const focusPracticeSurface = useCallback(() => {
    inputSurfaceRef.current?.focus()
  }, [])

  useEffect(() => {
    rimeStatusRef.current = rimeStatus
  }, [rimeStatus])

  useEffect(() => {
    selectedSchemaIdRef.current = selectedSchemaId
  }, [selectedSchemaId])

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

  const loadPracticeScheme = useCallback(async (schemeKey: PracticeSchemeKey) => {
    const scheme = PRACTICE_SCHEME_OPTIONS.find((item) => item.key === schemeKey) ?? PRACTICE_SCHEME_OPTIONS[0]
    const downloadId = ++activeSchemeDownloadIdRef.current
    setSelectedSchemeKey(schemeKey)
    setSchemeStatus('loading')
    setSchemeMessage(`正在获取 latest ${scheme.label} 方案`)
    setSchemeDownloadProgress(null)
    setFeedback(null)

    try {
      const releaseResponse = await fetch(`/api/practice/scheme-release?scheme=${schemeKey}`)
      if (!releaseResponse.ok) throw new Error(`无法获取 ${scheme.label} latest release`)
      const release = await releaseResponse.json() as PracticeSchemeReleaseInfo
      if (!release.downloadUrl) throw new Error(`latest release 中没有 ${scheme.asset}`)
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
      setSchemeStatus('error')
      setSchemeDownloadProgress(null)
      setSchemeMessage(error instanceof Error ? error.message : '键道方案加载失败')
    }
  }, [loadDictionaryFromZip, setSelectedSchemeKey, upsertCachedSchemeVersion])

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
    setCurrentIndex(0)
    setCompletedText('')
    setLastCompletedTarget(null)
    setTotalKeys(0)
    setWrongKeys(0)
    setPerfectItems(0)
    setItemHadMistake(false)
    setRimeComposition(null)
    if (rimeStatusRef.current === 'ready') {
      const schemaId = selectedSchemaIdRef.current
      if (schemaId) {
        void rimeEngineRef.current?.selectSchema(schemaId).catch(() => undefined)
      } else {
        void rimeEngineRef.current?.reset().catch(() => undefined)
      }
    }
    setStartTime(null)
    setElapsedMs(0)
    setFeedback(null)
    focusPracticeSurface()
  }, [focusPracticeSurface])

  const completeCurrentItem = useCallback(() => {
    if (!currentItem) return
    setCompletedText((value) => value + currentItem.text)
    setLastCompletedTarget(currentItem.text)
    setPerfectItems((value) => value + (itemHadMistake ? 0 : 1))
    setCurrentIndex((value) => value + 1)
    setRimeComposition(null)
    setItemHadMistake(false)
    setFeedback(null)
  }, [currentItem, itemHadMistake])

  const skipCurrentItem = useCallback(() => {
    if (!currentItem) return
    setCurrentIndex((value) => value + 1)
    setRimeComposition(null)
    setItemHadMistake(false)
    setFeedback(`已跳过「${currentItem.text}」`)
    focusPracticeSurface()
  }, [currentItem, focusPracticeSurface])

  const applyRimeResult = useCallback((result: RimeProcessResult) => {
    setRimeComposition(result.composition ?? null)

    if (!result.committedText) {
      setFeedback(null)
      return
    }

    if (currentItem && result.committedText === currentItem.text) {
      completeCurrentItem()
      return
    }

    setWrongKeys((value) => value + 1)
    setItemHadMistake(true)
    setFeedback(currentItem
      ? `输入法提交「${result.committedText}」，目标是「${currentItem.text}」`
      : `输入法提交「${result.committedText}」`)
  }, [completeCurrentItem, currentItem])

  const processRimeKey = useCallback(async (key: string) => {
    const engine = rimeEngineRef.current
    if (!engine) return

    try {
      applyRimeResult(await engine.processKey(key))
    } catch (error) {
      setRimeStatus('error')
      setRimeMessage(error instanceof Error ? error.message : 'librime wasm 输入失败')
    }
  }, [applyRimeResult])

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

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || !currentItem || isFinished) return

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
    if (!startTime) setStartTime(Date.now())
    setTotalKeys((value) => value + 1)
    void processRimeKey(rimeKey)
  }, [changeRimePage, currentItem, isFinished, isRimeReady, processRimeKey, startTime])

  const handleTextUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    const content = await file.text()
    const cleanedContent = content.replace(/\r\n/g, '\n').trim()
    if (!cleanedContent) {
      setFeedback('上传的文本是空的')
      return
    }

    setPracticeSource('custom')
    setDraftText(cleanedContent)
    setSourceText(cleanedContent)
    setFeedback(`已载入 ${file.name}`)
  }, [])

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

  const handlePracticeSchemeChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    const schemeKey = event.target.value
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
    let disposed = false

    async function loadKeyTaoConfig() {
      try {
        const response = await fetch('/api/practice/keytao-config')
        if (!response.ok) throw new Error('keytao config request failed')
        const data = await response.json() as KeyTaoConfigData
        if (!disposed) setKeytaoConfig(data)
      } catch {
        if (!disposed) setFeedback('拆分提示加载失败，练习仍可继续')
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

  useEffect(() => {
    focusPracticeSurface()
  }, [currentIndex, focusPracticeSurface, schemeStatus])

  return (
    <div className="min-h-screen bg-default-50/60">
      <main className="mx-auto flex max-w-375 flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <div className="rounded-small border border-default-200 bg-content1 px-5 py-5 shadow-sm">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-start gap-4">
              <div className="hidden rounded-small border border-primary-200 bg-primary-50 p-3 text-primary sm:block dark:bg-primary-50/10">
                <Keyboard className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-3xl font-bold tracking-normal">键道练习</h1>
                <p className="mt-2 max-w-3xl text-small leading-6 text-default-500">
                  目标字词由词典和专项规则生成，输入、候选和提交仍由浏览器里的真实 Rime 驱动。
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex h-10 items-center gap-2 rounded-small border border-default-200 bg-content1 px-3 text-small">
                <span className="text-default-500">方案</span>
                <select
                  value={selectedSchemeKey}
                  onChange={handlePracticeSchemeChange}
                  className="bg-transparent text-small font-medium outline-none"
                >
                  {PRACTICE_SCHEME_OPTIONS.map((scheme) => (
                    <option key={scheme.key} value={scheme.key}>{scheme.label}</option>
                  ))}
                </select>
              </label>
              <Tooltip content={`下载 latest ${selectedScheme.label} 方案`}>
                <Button
                  color="primary"
                  variant="flat"
                  startContent={<Download className="h-4 w-4" />}
                  isLoading={schemeStatus === 'loading'}
                  onPress={() => loadPracticeScheme(selectedSchemeKey)}
                >
                  下载{selectedScheme.label}
                </Button>
              </Tooltip>
              <Button variant="flat" startContent={<Upload className="h-4 w-4" />} onPress={() => schemeUploadRef.current?.click()}>
                上传方案
              </Button>
              <Button variant="flat" startContent={<FileText className="h-4 w-4" />} onPress={() => textUploadRef.current?.click()}>
                上传文本
              </Button>
              <Button variant="flat" isIconOnly aria-label="重置练习" onPress={resetSession}>
                <RotateCcw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        <input ref={textUploadRef} type="file" accept=".txt,text/plain" className="hidden" onChange={handleTextUpload} />
        <input ref={schemeUploadRef} type="file" accept=".zip,application/zip" className="hidden" onChange={handleSchemeUpload} />

        <Alert color={schemeStatus === 'error' ? 'danger' : schemeStatus === 'ready' ? 'success' : 'primary'} variant="flat" className="w-full">
          <div className="flex w-full flex-col gap-2">
            <div className="flex w-full flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <span>{schemeMessage}</span>
              {dictionary && (
                <span className="text-tiny text-default-500">
                  {dictionary.sourceName}{dictionary.version ? ` · ${dictionary.version}` : ''} · {dictionary.entries.length.toLocaleString()} 条去重记录
                </span>
              )}
            </div>
            {schemeDownloadProgress !== null && schemeStatus === 'loading' && (
              <Progress
                aria-label="方案下载进度"
                value={schemeDownloadProgress}
                color="primary"
                size="sm"
              />
            )}
            {selectedSchemeCachedVersions.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="text-tiny text-default-500">本地版本</span>
                {selectedSchemeCachedVersions.map((version) => (
                  <div key={`${version.schemeKey}-${version.version}`} className="inline-flex h-8 items-center gap-1 rounded-small border border-default-200 bg-content1 px-2 text-tiny">
                    <button
                      type="button"
                      className="font-medium text-primary hover:underline"
                      onClick={() => void loadCachedPracticeScheme(version)}
                    >
                      {version.version}
                    </button>
                    <span className="text-default-400">{formatBytes(version.size)}</span>
                    <Button
                      size="sm"
                      variant="light"
                      isIconOnly
                      aria-label={`删除 ${version.label} ${version.version}`}
                      className="h-6 min-w-6"
                      onPress={() => void deleteCachedPracticeScheme(version)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Alert>

        {showRimeStatus && (
          <Alert color={rimeStatus === 'ready' ? 'success' : rimeStatus === 'checking' ? 'primary' : 'warning'} variant="flat" className="w-full">
            <div className="flex w-full flex-col gap-3">
              <div className="flex w-full flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-lg font-semibold">{rimeMessage}</span>
                  <span className="text-small text-default-500">{rimeDetail}</span>
                </div>
                <span className="shrink-0 text-small font-medium text-default-500">
                  {rimeStatus === 'ready' ? 'Rime 引擎就绪' : rimeStatus === 'checking' ? '启动中' : '等待 Rime 运行时'}
                </span>
              </div>
              <Progress aria-label="Rime 启动进度" value={rimeProgress} color={rimeStatus === 'ready' ? 'success' : rimeStatus === 'checking' ? 'primary' : 'warning'} size="sm" />
              {isRimeReady && rimeSchemas.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {rimeSchemas.map((schema) => (
                    <Button
                      key={schema.id}
                      size="sm"
                      variant={selectedSchemaId === schema.id ? 'flat' : 'light'}
                      color={selectedSchemaId === schema.id ? 'primary' : 'default'}
                      onPress={() => void selectRimeSchema(schema.id)}
                    >
                      {schema.name}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          </Alert>
        )}

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="flex flex-col gap-4">
            <Card
              radius="sm"
              shadow="sm"
              onMouseDown={(event) => {
                const target = event.target as HTMLElement
                if (target.closest('button,[role="tab"],select,textarea')) return
                focusPracticeSurface()
              }}
              className={`border transition-colors ${isPracticeFocused ? 'border-primary bg-content1' : 'border-default-200 bg-content1'}`}
              style={{ height: 'min(42rem, calc(100vh - 16rem))' }}
            >
              <CardBody className="relative flex h-full flex-col overflow-hidden p-0">
                <div className="shrink-0 flex flex-col gap-3 border-b border-divider px-5 py-4 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-center gap-2 text-small text-default-500">
                    <Sparkles className="h-4 w-4 text-primary" />
                    <span>{PRACTICE_SOURCE_OPTIONS.find((item) => item.key === practiceSource)?.label}</span>
                    <span>·</span>
                    <span>{practiceItems.length.toLocaleString()} 项</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="light" startContent={<SkipForward className="h-4 w-4" />} onPress={skipCurrentItem} isDisabled={!currentItem || isFinished}>
                      跳过
                    </Button>
                    <Button size="sm" variant="light" isIconOnly aria-label="重置练习" onPress={resetSession}>
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div
                  ref={inputSurfaceRef}
                  tabIndex={0}
                  role="textbox"
                  aria-label="键道练习输入区"
                  onFocus={() => setIsPracticeFocused(true)}
                  onBlur={() => setIsPracticeFocused(false)}
                  onKeyDown={handleKeyDown}
                  onClick={focusPracticeSurface}
                  className={`min-h-0 flex-1 cursor-text overflow-y-auto px-5 pb-36 pt-8 outline-none transition-colors sm:px-8 ${isPracticeFocused ? 'focus-visible:ring-2 focus-visible:ring-primary/60' : 'opacity-85'}`}
                >
                  <div className="font-mono text-3xl leading-relaxed tracking-normal whitespace-pre-wrap wrap-break-word sm:text-4xl">
                    {practiceItems.length > 0 ? practiceItems.map((item, index) => {
                      const state = index < currentIndex ? 'done' : index === currentIndex && !isFinished ? 'current' : 'pending'
                      return (
                        <span
                          key={`${item.text}-${index}`}
                          className={`mx-0.5 inline-block border-b-2 pb-1 ${state === 'done'
                            ? 'border-success-400 text-success-500/80'
                            : state === 'current'
                              ? 'border-primary text-foreground'
                              : 'border-default-200 text-default-300'}`}
                        >
                          {item.text}
                        </span>
                      )
                    }) : (
                      <span className="font-semibold text-success">完成</span>
                    )}
                  </div>
                </div>

                {isPracticeFocused && currentItem && !isFinished && (
                  <div className={`absolute bottom-0 left-0 right-0 z-20 overflow-hidden border-t bg-content1/95 shadow-lg backdrop-blur ${hasInputError ? 'border-danger' : 'border-primary/40'}`}>
                    <div className={`flex items-center gap-3 border-b px-4 py-3 ${hasInputError ? 'border-danger/30 bg-danger-50 dark:bg-danger-50/10' : 'border-divider bg-default-100/80'}`}>
                      <span className={`min-h-7 break-all font-mono text-xl ${hasInputError ? 'text-danger' : 'text-primary'}`}>
                        {displayedInput || <span className="text-default-300">_</span>}
                      </span>
                      {hasInputError && (
                        <span className="inline-flex items-center gap-1 text-small text-danger">
                          <AlertTriangle className="h-4 w-4 shrink-0" />
                          {feedback}
                        </span>
                      )}
                    </div>
                    <div className="flex min-h-16 items-center gap-2 overflow-x-auto overscroll-x-contain px-3 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                      {displayedCandidates.length > 0 ? displayedCandidates.map((candidate, index) => {
                        const isTarget = candidate.text === currentItem?.text
                        const candidateHint = candidate.comment
                        return (
                          <button
                            key={`${candidate.text}-${candidateHint ?? ''}-${index}`}
                            type="button"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                              void selectRimeCandidate(index)
                              focusPracticeSurface()
                            }}
                            className={`inline-flex shrink-0 items-center gap-2 rounded-small border px-3 py-2 text-small transition-colors ${isTarget ? 'border-primary bg-primary text-primary-foreground' : 'border-divider bg-content1 text-foreground hover:bg-default-100'}`}
                          >
                            <span className="font-mono text-tiny opacity-70">{getCandidateLabel(index)}</span>
                            <span className="text-base leading-none">{candidate.text}</span>
                            {candidateHint && <span className="font-mono text-tiny opacity-60">{candidateHint}</span>}
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
                <KeyTaoGraph visible={isKeyMapVisible} />
              </CardBody>
            </Card>
          </div>

          <div className="flex flex-col gap-4">
            <Card radius="sm" shadow="sm" className="border border-divider">
              <CardBody className="gap-4">
                <div>
                  <h2 className="text-lg font-semibold">练习来源</h2>
                  <p className="mt-1 text-small text-default-500">已移除文字数量限制，按来源完整生成目标。</p>
                </div>
                <Tabs
                  selectedKey={practiceSource}
                  onSelectionChange={(key) => setPracticeSource(key as PracticeSource)}
                  color="primary"
                  variant="underlined"
                  classNames={{ tabList: 'flex-wrap' }}
                >
                  {PRACTICE_SOURCE_OPTIONS.map((option) => (
                    <Tab key={option.key} title={option.label} />
                  ))}
                </Tabs>
                {practiceSource === 'article' && (
                  <label className="flex flex-col gap-2 text-small">
                    <span className="text-default-500">文章</span>
                    <select
                      value={selectedArticleId}
                      onChange={(event) => setSelectedArticleId(event.target.value)}
                      className="h-10 rounded-small border border-default-200 bg-content1 px-3 text-small outline-none focus:border-primary"
                    >
                      {ARTICLE_OPTIONS.map((article) => <option key={article.id} value={article.id}>{article.title}</option>)}
                    </select>
                  </label>
                )}
                {practiceSource === 'custom' && (
                  <div className="flex flex-col gap-3">
                    <Textarea
                      minRows={6}
                      value={draftText}
                      onValueChange={setDraftText}
                      placeholder="粘贴或上传 .txt 练习内容"
                      classNames={{ input: 'text-small leading-6' }}
                    />
                    <Button
                      color="primary"
                      variant="flat"
                      onPress={() => {
                        setPracticeSource('custom')
                        setSourceText(draftText)
                      }}
                    >
                      应用文本
                    </Button>
                  </div>
                )}
              </CardBody>
            </Card>

            <Card radius="sm" shadow="sm" className="border border-divider">
              <CardBody className="gap-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">状态</h2>
                  <Chip size="sm" variant="flat" color={isRimeReady ? 'success' : 'warning'}>{isRimeReady ? 'Rime 就绪' : '等待 Rime'}</Chip>
                </div>
                <Progress aria-label="练习进度" value={progressValue} color="primary" size="sm" />
                <div className="grid grid-cols-2 gap-3 text-small">
                  <div className="rounded-small bg-default-100 px-3 py-2">
                    <div className="text-default-500">进度</div>
                    <div className="text-lg font-semibold">{Math.min(currentIndex, practiceItems.length)} / {practiceItems.length}</div>
                  </div>
                  <div className="rounded-small bg-default-100 px-3 py-2">
                    <div className="text-default-500">时间</div>
                    <div className="font-mono text-lg font-semibold">{formatElapsed(elapsedMs)}</div>
                  </div>
                  <div className="rounded-small bg-default-100 px-3 py-2">
                    <div className="text-default-500">准确率</div>
                    <div className="text-lg font-semibold">{accuracy}%</div>
                  </div>
                  <div className="rounded-small bg-default-100 px-3 py-2">
                    <div className="text-default-500">速度</div>
                    <div className="text-lg font-semibold">{speed} 字/分</div>
                  </div>
                </div>
                <div className="text-small text-default-500">无错通过 {perfectItems} 项，错误按键 {wrongKeys} 次。</div>
              </CardBody>
            </Card>

            <Card radius="sm" shadow="sm" className="border border-divider">
              <CardBody className="gap-3">
                <div className="flex items-center gap-2">
                  <Info className="h-4 w-4 text-primary" />
                  <h2 className="text-lg font-semibold">拆分与编码</h2>
                </div>
                <InsightPanel title="当前目标" insight={currentInsight} />
                <InsightPanel title="刚完成" insight={lastCompletedInsight} />
              </CardBody>
            </Card>

            <Card radius="sm" shadow="sm" className="border border-divider">
              <CardBody className="gap-3">
                <h2 className="text-lg font-semibold">飞键规则</h2>
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
              </CardBody>
            </Card>

          </div>
        </section>
      </main>
    </div>
  )
}
