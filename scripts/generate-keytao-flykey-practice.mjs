import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pinyin } from 'pinyin-pro'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const LOCAL_SINGLE_DICT = '/home/rea/code/KeyTao/rime/keytao.single.dict.yaml'
const REMOTE_SINGLE_DICT = 'https://raw.githubusercontent.com/xkinput/Rime_JD/master/rime/keytao.single.dict.yaml'
const KEYTAO_SINGLE_DICT_LABEL = 'xkinput/Rime_JD:rime/keytao.single.dict.yaml'
const DEFAULT_OUTPUT = path.join(repoRoot, 'lib/data/keytaoFlyKeyPractice.ts')
const DEFAULT_LIMIT = 500
const DEFAULT_COMMON_SCAN_LIMIT = 10000
const COMMON_FREQUENCY_SOURCE = 'https://lingua.mtsu.edu/chinese-computing/statistics/char/list.php?Which=MO'
const COMMON_FREQUENCY_SOURCE_LABEL = 'Jun Da Modern Chinese Character Frequency List'
const COMMON_FREQUENCY_FALLBACK = '的一是在不了有和人这中大为上个国我以要他时来用们生到作地于出就分对成会可主发年动同工也能下过子说产种面而方后多定行学法所民得经十三之进着等部度家电力里如水化高自二理起小物现实加量都两体制机当使点从业本去把性好应开它合还因由其些然前外天政四日那社义事平形相全表间样与关各重新线内数正心反你明看原又么利比或但质气第向道命此变条只没结解问意建月公无系军很情者最立代想已通并提直题党程展五果料象员革位入常文总次品式活设及管特件长求老头基资边流路级少图山统接知较将组见计别她手角期根论运农指几九区强放决西被干做必战先回则任取据处队南给色光门即保治北造百规热领七海口东导器压志世金增争济阶油思术极交受联什认六共权收证改清己美再采转更单风切打白教速花带安场身车例真务具万每目至达走积示议声报斗完类八离华名确才科张信马节话米整空元况今集温传土许步群广石记需段研界拉林律叫且究观越织装影算低持音众书布复容儿须际商非验连断深难近矿千周委素技备半办青省列习响约支般史感劳便团往酸历市克何除消构府称太准精值号率族维划选标写存候毛亲快效斯院查江型眼王按格养易置派层片始却专状育厂京识适属圆包火住调满县局照参红细引听该铁价严龙飞'

const ZH_OUTER_FINALS = new Set(['an', 'ang', 'ei', 'en', 'eng', 'u', 'un'])
const ZH_OUTER_FLY_FINALS = new Set(['ai', 'ao', 'e'])
const ZH_INNER_FINALS = new Set(['a', 'i', 'ong', 'ou', 'ua', 'uai', 'uan', 'uang', 'ui', 'uo'])
const CH_OUTER_FINALS = new Set(['ai', 'an', 'ang', 'en', 'eng', 'u', 'un'])
const CH_OUTER_FLY_FINALS = new Set(['ao', 'e'])
const CH_INNER_FINALS = ZH_INNER_FINALS

const INITIALS = [
  'zh',
  'ch',
  'sh',
  'b',
  'p',
  'm',
  'f',
  'd',
  't',
  'n',
  'l',
  'g',
  'k',
  'h',
  'j',
  'q',
  'x',
  'r',
  'z',
  'c',
  's',
  'y',
  'w',
]

function parseArgs() {
  const options = {
    source: process.env.KEYTAO_DANZI_SOURCE || '',
    commonSource: process.env.KEYTAO_COMMON_CHARACTER_SOURCE || COMMON_FREQUENCY_SOURCE,
    output: DEFAULT_OUTPUT,
    limit: DEFAULT_LIMIT,
    commonScanLimit: DEFAULT_COMMON_SCAN_LIMIT,
  }

  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index]
    const next = process.argv[index + 1]

    if ((arg === '--source' || arg === '-s') && next) {
      options.source = next
      index += 1
    } else if ((arg === '--output' || arg === '-o') && next) {
      options.output = path.resolve(process.cwd(), next)
      index += 1
    } else if ((arg === '--limit' || arg === '-l') && next) {
      const limit = Number.parseInt(next, 10)
      if (Number.isFinite(limit) && limit > 0) options.limit = limit
      index += 1
    } else if (arg === '--common-source' && next) {
      options.commonSource = next
      index += 1
    } else if (arg === '--common-scan-limit' && next) {
      const commonScanLimit = Number.parseInt(next, 10)
      if (Number.isFinite(commonScanLimit) && commonScanLimit > 0) options.commonScanLimit = commonScanLimit
      index += 1
    }
  }

  if (!options.source) {
    options.source = existsSync(LOCAL_SINGLE_DICT) ? LOCAL_SINGLE_DICT : REMOTE_SINGLE_DICT
  }

  return options
}

async function readSource(source) {
  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source, {
      headers: { 'User-Agent': 'KeyTao-Next-FlyKey-Practice-Generator' },
    })
    if (!response.ok) {
      throw new Error(`无法读取远程词库 ${source}: ${response.status} ${response.statusText}`)
    }
    return await response.text()
  }

  return await readFile(path.resolve(process.cwd(), source), 'utf-8')
}

async function readCommonCharacterSource(source) {
  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source, {
      headers: { 'User-Agent': 'KeyTao-Next-FlyKey-Practice-Generator' },
    })
    if (!response.ok) {
      throw new Error(`无法读取常用字频源 ${source}: ${response.status} ${response.statusText}`)
    }
    return new TextDecoder('gb18030').decode(await response.arrayBuffer())
  }

  return await readFile(path.resolve(process.cwd(), source), 'utf-8')
}

function parseRimeDict(content) {
  const entries = []
  const lines = content.split(/\r?\n/)
  let inDataSection = false

  for (const rawLine of lines) {
    const trimmed = rawLine.trim()
    if (trimmed === '...') {
      inDataSection = true
      continue
    }

    if (!inDataSection || !trimmed || trimmed.startsWith('#')) continue

    const parts = rawLine.includes('\t')
      ? rawLine.split('\t').map((part) => part.trim())
      : trimmed.split(/\s+/).map((part) => part.trim())

    if (parts.length < 2) continue
    const [text, code] = parts
    if (!text || !code || Array.from(text).length !== 1) continue

    const weight = parts[2] ? Number.parseInt(parts[2], 10) : 0
    entries.push({
      text,
      code: code.toLowerCase(),
      weight: Number.isFinite(weight) ? weight : 0,
    })
  }

  return entries
}

function readRimeYamlScalar(content, key) {
  const match = content.match(new RegExp(`^\\s*${key}:\\s*([^\\n#]+)`, 'm'))
  return match?.[1]?.trim().replace(/^['"]|['"]$/g, '') ?? ''
}

function normalizeSourceLabel(source) {
  if (source === LOCAL_SINGLE_DICT || source === REMOTE_SINGLE_DICT) return KEYTAO_SINGLE_DICT_LABEL
  return source
}

function normalizeCommonSourceLabel(source) {
  if (source === COMMON_FREQUENCY_SOURCE) return COMMON_FREQUENCY_SOURCE_LABEL
  return source
}

function parsePinyinSyllable(syllable) {
  const normalized = syllable.toLowerCase().replace(/[^a-z]/g, '')
  const initial = INITIALS.find((candidate) => normalized.startsWith(candidate)) ?? ''
  return {
    initial,
    final: normalized.slice(initial.length),
  }
}

function getPinyinReadings(char) {
  const result = pinyin(char, { type: 'array', toneType: 'none', multiple: true })
  return Array.isArray(result) ? Array.from(new Set(result.filter(Boolean))) : []
}

function getFlyKeyRuleIds(initial, final) {
  const ids = []

  if (initial === 'zh') {
    if (ZH_OUTER_FINALS.has(final)) ids.push('zh-outer')
    if (ZH_OUTER_FLY_FINALS.has(final)) ids.push('zh-inner')
    if (ZH_INNER_FINALS.has(final)) ids.push('zh-inner')
  }

  if (initial === 'ch') {
    if (CH_OUTER_FINALS.has(final)) ids.push('ch-outer')
    if (CH_OUTER_FLY_FINALS.has(final)) ids.push('ch-inner')
    if (CH_INNER_FINALS.has(final)) ids.push('ch-inner')
  }

  if (final === 'uang') {
    ids.push(initial === 'zh' || initial === 'ch' ? 'uang-x' : 'uang-m')
  }

  return Array.from(new Set(ids))
}

function parseCommonCharacterOrder(content) {
  const preBlock = content.match(/<pre>([\s\S]*?)<\/pre>/i)?.[1]
  if (preBlock) {
    return preBlock
      .split(/<br\s*\/?>/i)
      .map((line) => line.replace(/<[^>]*>/g, '').trim().split(/\t/)[1] ?? '')
      .filter((char) => Array.from(char).length === 1)
  }

  return Array.from(content).filter((char) => /\p{Script=Han}/u.test(char))
}

function buildCommonCharacterRank(commonCharacterOrder, commonScanLimit) {
  const chars = commonCharacterOrder.length > 0
    ? commonCharacterOrder
    : Array.from(COMMON_FREQUENCY_FALLBACK)

  const uniqueChars = []
  const seenChars = new Set()
  for (const char of chars) {
    if (seenChars.has(char)) continue
    seenChars.add(char)
    uniqueChars.push(char)
    if (uniqueChars.length >= commonScanLimit) break
  }

  return new Map(uniqueChars.map((char, index) => [char, index]))
}

function buildFlyKeyCharacters(entries, { limit, commonCharacterOrder, commonScanLimit }) {
  const byText = new Map()
  const commonRank = buildCommonCharacterRank(commonCharacterOrder, commonScanLimit)

  for (const entry of entries) {
    const rank = commonRank.get(entry.text)
    if (rank === undefined) continue

    const readings = getPinyinReadings(entry.text)
    const ruleIds = Array.from(new Set(readings.flatMap((reading) => {
      const { initial, final } = parsePinyinSyllable(reading)
      return getFlyKeyRuleIds(initial, final)
    })))
    if (ruleIds.length === 0) continue

    const existing = byText.get(entry.text)
    const nextCodes = existing?.codes ?? []
    if (!nextCodes.includes(entry.code)) nextCodes.push(entry.code)

    if (!existing || entry.weight > existing.weight) {
      byText.set(entry.text, {
        text: entry.text,
        readings,
        ruleIds,
        codes: nextCodes,
        weight: entry.weight,
        rank,
      })
    } else {
      existing.codes = nextCodes
    }
  }

  return Array.from(byText.values())
    .sort((a, b) => (
      a.rank - b.rank
      || b.weight - a.weight
    ))
    .slice(0, limit)
    .map((item) => ({
      text: item.text,
    }))
}

function toTsFile({ source, sourceVersion, commonSource, limit, commonScanLimit, totalEntries, characters }) {
  const characterText = characters.map((item) => item.text).join('')

  return `// Generated by scripts/generate-keytao-flykey-practice.mjs. Do not edit by hand.

export const KEYTAO_FLY_KEY_SOURCE = ${JSON.stringify({ source, sourceVersion, commonSource, limit, commonScanLimit, totalEntries, totalCharacters: characters.length }, null, 2)} as const

export const KEYTAO_FLY_KEY_CHARACTERS = ${JSON.stringify(characterText)} as const
`
}

async function main() {
  const options = parseArgs()
  const [content, commonContent] = await Promise.all([
    readSource(options.source),
    readCommonCharacterSource(options.commonSource),
  ])
  const entries = parseRimeDict(content)
  const commonCharacterOrder = parseCommonCharacterOrder(commonContent)
  const characters = buildFlyKeyCharacters(entries, {
    limit: options.limit,
    commonCharacterOrder,
    commonScanLimit: options.commonScanLimit,
  })
  if (characters.length < options.limit) {
    throw new Error(`按当前常用字序只找到 ${characters.length} 个飞键字，未达到目标 ${options.limit} 个`)
  }
  const output = path.resolve(process.cwd(), options.output)

  await mkdir(path.dirname(output), { recursive: true })
  await writeFile(output, toTsFile({
    source: normalizeSourceLabel(options.source),
    sourceVersion: readRimeYamlScalar(content, 'version'),
    commonSource: normalizeCommonSourceLabel(options.commonSource),
    limit: options.limit,
    commonScanLimit: options.commonScanLimit,
    totalEntries: entries.length,
    characters,
  }))

  console.log(`已生成 ${characters.length} 个飞键练习单字 -> ${path.relative(process.cwd(), output)}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
