import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { isValidPhraseType, type PhraseType } from '@/lib/constants/phraseTypes'

export async function GET(request: NextRequest) {
  try {
    const maxPage = 100
    const maxPageSize = 100
    const maxSearchLength = 50
    const maxSearchScan = 500
    const searchParams = request.nextUrl.searchParams
    const page = Math.min(maxPage, Math.max(1, parseInt(searchParams.get('page') || '1')))
    const pageSize = Math.min(maxPageSize, Math.max(1, parseInt(searchParams.get('pageSize') || '20')))
    const search = (searchParams.get('search') || '').trim()
    const type = searchParams.get('type') || ''

    if (type && !isValidPhraseType(type)) {
      return NextResponse.json(
        { error: '无效的类型参数' },
        { status: 400 }
      )
    }

    if (search.length > maxSearchLength) {
      return NextResponse.json(
        { error: `搜索关键词最多 ${maxSearchLength} 个字符` },
        { status: 400 }
      )
    }

    const typeFilter = type ? { type: type as PhraseType } : {}
    const baseWhere = { ...typeFilter, status: 'Finish' as const }

    if (!search) {
      const [phrases, total, phrasesByTypeData] = await Promise.all([
        prisma.phrase.findMany({
          where: baseWhere,
          select: {
            id: true,
            word: true,
            code: true,
            type: true,
            status: true,
            weight: true,
            remark: true,
            createAt: true,
          },
          orderBy: [{ code: 'asc' }, { weight: 'asc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.phrase.count({ where: baseWhere }),
        prisma.phrase.groupBy({
          where: { status: 'Finish' },
          by: ['type'],
          _count: { id: true },
        }),
      ])

      const phrasesByType = phrasesByTypeData.reduce((acc, item) => {
        acc[item.type] = item._count.id
        return acc
      }, {} as Record<string, number>)

      return NextResponse.json({ phrases, total, phrasesByType })
    }

    const exactMatches = await prisma.phrase.findMany({
      where: {
        ...baseWhere,
        OR: [
          { word: { equals: search } },
          { code: { equals: search } },
        ],
      },
      select: {
        id: true,
        word: true,
        code: true,
        type: true,
        status: true,
        weight: true,
        remark: true,
        createAt: true,
      },
      orderBy: [{ code: 'asc' }, { weight: 'asc' }],
      take: maxSearchScan,
    })

    const startsWithMatches = await prisma.phrase.findMany({
      where: {
        ...baseWhere,
        AND: [
          { OR: [{ word: { startsWith: search } }, { code: { startsWith: search } }] },
          { NOT: { OR: [{ word: { equals: search } }, { code: { equals: search } }] } },
        ],
      },
      select: {
        id: true,
        word: true,
        code: true,
        type: true,
        status: true,
        weight: true,
        remark: true,
        createAt: true,
      },
      orderBy: [{ code: 'asc' }, { weight: 'asc' }],
      take: maxSearchScan,
    })

    const containsMatches = await prisma.phrase.findMany({
      where: {
        ...baseWhere,
        AND: [
          { OR: [{ word: { contains: search } }, { code: { contains: search } }] },
          { NOT: { OR: [{ word: { startsWith: search } }, { code: { startsWith: search } }] } },
        ],
      },
      select: {
        id: true,
        word: true,
        code: true,
        type: true,
        status: true,
        weight: true,
        remark: true,
        createAt: true,
      },
      orderBy: [{ code: 'asc' }, { weight: 'asc' }],
      take: maxSearchScan,
    })

    const allMatches = [...exactMatches, ...startsWithMatches, ...containsMatches]
    const total = allMatches.length
    const phrases = allMatches.slice((page - 1) * pageSize, page * pageSize)

    const phrasesByTypeData = await prisma.phrase.groupBy({
      where: { status: 'Finish' },
      by: ['type'],
      _count: { id: true },
    })

    const phrasesByType = phrasesByTypeData.reduce((acc, item) => {
      acc[item.type] = item._count.id
      return acc
    }, {} as Record<string, number>)

    return NextResponse.json({ phrases, total, phrasesByType })
  } catch (error) {
    console.error('Get phrases error:', error)
    return NextResponse.json(
      { error: '获取词条列表失败' },
      { status: 500 }
    )
  }
}
