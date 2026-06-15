import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { isValidPhraseType, type PhraseType } from '@/lib/constants/phraseTypes'

export interface ContextPhrase {
  word: string
  code: string
  weight: number
}

export interface ContextResponse {
  /** 3 phrases with codes just before target, ascending order for display */
  before: ContextPhrase[]
  /** phrases at exactly this code */
  at: ContextPhrase[]
  /** 3 phrases with codes just after target, ascending order */
  after: ContextPhrase[]
}

// GET /api/phrases/context?code=xxx&count=3&type=Phrase
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')?.trim()
  const type = request.nextUrl.searchParams.get('type')?.trim() || undefined
  const rawCount = parseInt(request.nextUrl.searchParams.get('count') ?? '3', 10)
  const count = Number.isFinite(rawCount) ? Math.min(6, Math.max(1, rawCount)) : 3

  if (!code) return NextResponse.json({ error: '缺少参数 code' }, { status: 400 })
  if (code.length > 20) return NextResponse.json({ error: 'code 过长' }, { status: 400 })
  if (type && !isValidPhraseType(type)) return NextResponse.json({ error: 'type 无效' }, { status: 400 })

  const select = { word: true, code: true, weight: true } as const
  const phraseType = type as PhraseType | undefined
  const baseFilter = { status: 'Finish' as const, ...(phraseType ? { type: phraseType } : {}) }

  const [beforeRaw, at, after] = await Promise.all([
    prisma.phrase.findMany({
      where: { ...baseFilter, code: { lt: code } },
      orderBy: [{ code: 'desc' }, { weight: 'desc' }],
      take: count,
      select,
    }),
    prisma.phrase.findMany({
      where: { ...baseFilter, code },
      orderBy: { weight: 'desc' },
      select,
    }),
    prisma.phrase.findMany({
      where: { ...baseFilter, code: { gt: code } },
      orderBy: [{ code: 'asc' }, { weight: 'desc' }],
      take: count,
      select,
    }),
  ])

  return NextResponse.json({
    before: beforeRaw.reverse(),
    at,
    after,
  } satisfies ContextResponse)
}
