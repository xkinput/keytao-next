import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkAdminPermission } from '@/lib/adminAuth'

export async function GET(request: NextRequest) {
  // 验证管理员权限
  const authCheck = await checkAdminPermission()
  if (!authCheck.authorized) {
    return authCheck.response
  }

  try {
    const searchParams = request.nextUrl.searchParams
    const page = parseInt(searchParams.get('page') || '1')
    const pageSize = parseInt(searchParams.get('pageSize') || '20')
    const search = searchParams.get('search') || ''

    if (!search) {
      // No search term, return all with pagination
      const [phrases, total] = await Promise.all([
        prisma.phrase.findMany({
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
          orderBy: { weight: 'asc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.phrase.count(),
      ])

      return NextResponse.json({ phrases, total })
    }

    // With search: prioritize exact matches, then startsWith, then contains
    // First query: exact matches (highest priority)
    const exactMatches = await prisma.phrase.findMany({
      where: {
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
      orderBy: { weight: 'asc' },
    })

    // Second query: startsWith matches (medium priority)
    const startsWithMatches = await prisma.phrase.findMany({
      where: {
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
      orderBy: { weight: 'asc' },
    })

    // Third query: contains but not startsWith (lowest priority)
    const containsMatches = await prisma.phrase.findMany({
      where: {
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
      orderBy: { weight: 'asc' },
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
