import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { isValidPhraseType, type PhraseType } from '@/lib/constants/phraseTypes'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const page = parseInt(searchParams.get('page') || '1')
    const pageSize = parseInt(searchParams.get('pageSize') || '20')
    const search = searchParams.get('search') || ''
    const type = searchParams.get('type') || ''

    // Validate type filter if provided
    if (type && !isValidPhraseType(type)) {
      return NextResponse.json(
        { error: '无效的类型参数' },
        { status: 400 }
      )
    }

    // Build type filter
    const typeFilter = type ? { type: type as PhraseType } : {}

    if (!search) {
      // No search term, return all with pagination and type filter
      const [phrases, total] = await Promise.all([
        prisma.phrase.findMany({
          where: typeFilter,
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
        prisma.phrase.count({ where: typeFilter }),
      ])

      return NextResponse.json({ phrases, total })
    }

    // With search: prioritize exact matches, then startsWith, then contains
    // First query: exact matches (highest priority)
    const exactMatches = await prisma.phrase.findMany({
      where: {
        ...typeFilter,
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
    })

    // Second query: startsWith matches (medium priority)
    const startsWithMatches = await prisma.phrase.findMany({
      where: {
        ...typeFilter,
        AND: [
          {
            OR: [
              { word: { startsWith: search } },
              { code: { startsWith: search } },
            ],
          },
          {
            NOT: {
              OR: [
                { word: { equals: search } },
                { code: { equals: search } },
              ],
            },
          },
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
    })

    // Third query: contains but not startsWith (lowest priority)
    const containsMatches = await prisma.phrase.findMany({
      where: {
        ...typeFilter,
        AND: [
          {
            OR: [
              { word: { contains: search } },
              { code: { contains: search } },
            ],
          },
          {
            NOT: {
              OR: [
                { word: { startsWith: search } },
                { code: { startsWith: search } },
              ],
            },
          },
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
    })

    // Combine results: exact first, then startsWith, then contains
    const allMatches = [...exactMatches, ...startsWithMatches, ...containsMatches]
    const total = allMatches.length

    // Apply pagination
    const phrases = allMatches.slice((page - 1) * pageSize, page * pageSize)

    return NextResponse.json({ phrases, total })
  } catch (error) {
    console.error('Get phrases error:', error)
    return NextResponse.json(
      { error: '获取词条列表失败' },
      { status: 500 }
    )
  }
}
