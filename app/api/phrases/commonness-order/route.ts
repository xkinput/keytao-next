import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { CODE_PATTERN } from '@/lib/constants/codeValidation'
import { isValidPhraseType } from '@/lib/constants/phraseTypes'
import { InvalidJsonBodyError, readLimitedJson, RequestBodyTooLargeError } from '@/lib/limitedJsonBody'
import { prisma } from '@/lib/prisma'
import { checkRateLimit } from '@/lib/rateLimit'
import {
  COMMONNESS_ORDER_LIMITS as limits, draftOrderKey, isCommonnessOrderWord,
  type CommonnessLines, type CommonnessOrderChain, type CommonnessOrderResponse,
} from '@/lib/types/commonnessOrder'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isChain(value: unknown): value is CommonnessOrderChain {
  if (!isRecord(value)) return false
  const { code, type, entries } = value
  return typeof code === 'string' && code.length <= limits.codeLength && CODE_PATTERN.test(code)
    && typeof type === 'string' && isValidPhraseType(type)
    && Array.isArray(entries) && entries.length >= 2 && entries.length <= limits.entries
    && entries.every(entry => isRecord(entry) && isCommonnessOrderWord(entry.word)
      && (entry.weight === null || Number.isSafeInteger(entry.weight))
      && (entry.source === 'current' || entry.source === 'draft')
      && (entry.prId === undefined || (typeof entry.prId === 'number' && Number.isSafeInteger(entry.prId) && entry.prId > 0))
      && Object.keys(entry).every(key => ['word', 'weight', 'source', 'prId'].includes(key)))
    && new Set(entries.map(entry => entry.word)).size === entries.length
    && Object.keys(value).every(key => ['code', 'type', 'entries'].includes(key))
}

function parseResponse(value: unknown, requested: CommonnessOrderChain[]): Omit<CommonnessOrderResponse, 'reservedWeights'> | null {
  if (!isRecord(value) || value.success === false || !Array.isArray(value.chains)
      || value.chains.length !== requested.length || !isRecord(value.words)) return null

  const chains: CommonnessOrderResponse['chains'] = []
  const allowedWords = new Set<string>()
  for (const [index, { code, type, entries }] of requested.entries()) {
    const chain: unknown = value.chains[index]
    if (!isRecord(chain) || chain.code !== code || chain.type !== type) return null
    const { status, orderedWords } = chain
    if (status !== 'reorder' && status !== 'keep' && status !== 'ask') return null
    const expectedWords = new Set(entries.map(entry => entry.word))
    if (!Array.isArray(orderedWords) || orderedWords.length !== entries.length
        || new Set(orderedWords).size !== expectedWords.size
        || !orderedWords.every(word => expectedWords.has(word))) return null
    chains.push({ code, type, status, orderedWords })
    expectedWords.forEach(word => allowedWords.add(word))
  }

  const words: Array<[string, CommonnessLines]> = []
  for (const [word, lines] of Object.entries(value.words)) {
    if (!allowedWords.has(word) || !isRecord(lines)) return null
    const { daily, authority } = lines
    if ((daily !== undefined && typeof daily !== 'string')
        || (authority !== undefined && typeof authority !== 'string')) return null
    words.push([word, { daily, authority }])
  }
  return { chains, words: Object.fromEntries(words) }
}

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const { allowed, retryAfterMs } = checkRateLimit(`commonness-order:${session.id}`)
  if (!allowed) {
    return NextResponse.json({ error: '请求过于频繁', retryAfterMs }, {
      status: 429,
      headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) },
    })
  }

  let body: unknown
  try {
    body = await readLimitedJson(request, 32 * 1024)
  } catch (error) {
    if (error instanceof InvalidJsonBodyError || error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    throw error
  }
  if (!isRecord(body) || !Array.isArray(body.chains) || body.chains.length < 1
      || body.chains.length > limits.chains || !body.chains.every(isChain)
      || new Set(body.chains.flatMap(chain => chain.entries.map(entry => entry.word))).size > limits.words) {
    return NextResponse.json({ error: '排序请求格式错误' }, { status: 400 })
  }

  const baseUrl = (process.env.BOT_API_URL || 'http://localhost:8080').replace(/\/+$/, '')
  const apiKey = process.env.BOT_API_KEY || ''
  if (!apiKey) return NextResponse.json({ error: '排序服务未配置' }, { status: 503 })
  const signal = AbortSignal.timeout(15_000)
  let result: ReturnType<typeof parseResponse> = null
  try {
    const upstream = await fetch(`${baseUrl}/api/keytao/commonness-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ chains: body.chains }),
      redirect: 'error',
      signal,
    })
    if (upstream.ok) result = parseResponse(await upstream.json(), body.chains)
  } catch {
    if (signal.aborted) return NextResponse.json({ error: '排序服务超时' }, { status: 504 })
  }
  if (!result) return NextResponse.json({ error: '排序服务响应无效' }, { status: 502 })

  const slots = result.chains.map(({ code, type }) => ({ code, type }))
  // Approval checks weight collisions against every phrase status.
  const phrases = await prisma.phrase.findMany({
    where: { OR: slots },
    select: { code: true, type: true, weight: true },
  })
  const reservedWeights = Object.fromEntries<number[]>(slots.map(({ code, type }) => [draftOrderKey(code, type), []]))
  for (const { code, type, weight } of phrases) reservedWeights[draftOrderKey(code, type)].push(weight)
  return NextResponse.json({ ...result, reservedWeights })
}
