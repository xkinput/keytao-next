import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyApiKey } from '@/lib/apiKeyAuth'
import { isValidPhraseType, type PhraseType } from '@/lib/constants/phraseTypes'

export async function GET(request: NextRequest) {
  const auth = await verifyApiKey()
  if (!auth.success) return auth.response

  const searchParams = request.nextUrl.searchParams
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '20')))
  const search = searchParams.get('search') || ''
  const type = searchParams.get('type') || ''

  if (type && !isValidPhraseType(type)) {
    return NextResponse.json({ error: '无效的类型参数' }, { status: 400 })
  }

  const typeFilter = type ? { type: type as PhraseType } : {}
  const statusFilter = { status: 'Finish' as const }
  const baseWhere = { ...typeFilter, ...statusFilter }

  if (!search) {
    const [phrases, total] = await Promise.all([
      prisma.phrase.findMany({
        where: baseWhere,
        select: { id: true, word: true, code: true, type: true, weight: true, remark: true },
        orderBy: [{ code: 'asc' }, { weight: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.phrase.count({ where: baseWhere }),
    ])
    return NextResponse.json({ phrases, total, page, pageSize })
  }

  const exactMatches = await prisma.phrase.findMany({
    where: { ...baseWhere, OR: [{ word: { equals: search } }, { code: { equals: search } }] },
    select: { id: true, word: true, code: true, type: true, weight: true, remark: true },
    orderBy: [{ code: 'asc' }, { weight: 'asc' }],
  })

  const startsWithMatches = await prisma.phrase.findMany({
    where: {
      ...baseWhere,
      AND: [
        { OR: [{ word: { startsWith: search } }, { code: { startsWith: search } }] },
        { NOT: { OR: [{ word: { equals: search } }, { code: { equals: search } }] } },
      ],
    },
    select: { id: true, word: true, code: true, type: true, weight: true, remark: true },
    orderBy: [{ code: 'asc' }, { weight: 'asc' }],
  })

  const containsMatches = await prisma.phrase.findMany({
    where: {
      ...baseWhere,
      AND: [
        { OR: [{ word: { contains: search } }, { code: { contains: search } }] },
        { NOT: { OR: [{ word: { startsWith: search } }, { code: { startsWith: search } }] } },
      ],
    },
    select: { id: true, word: true, code: true, type: true, weight: true, remark: true },
    orderBy: [{ code: 'asc' }, { weight: 'asc' }],
  })

  const allMatches = [...exactMatches, ...startsWithMatches, ...containsMatches]
  const total = allMatches.length
  const phrases = allMatches.slice((page - 1) * pageSize, page * pageSize)

  return NextResponse.json({ phrases, total, page, pageSize })
}
