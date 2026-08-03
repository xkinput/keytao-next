import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

import { MAX_CODE_LENGTH_ANY_TYPE as MAX_CODE_LENGTH } from '@/lib/constants/codeValidation'

// GET /api/phrases/by-code?code=xxx&page=1 - Get phrases by code prefix with pagination (public access)
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const code = searchParams.get('code')?.trim()
    const rawPage = parseInt(searchParams.get('page') || '1', 10)
    const page = Number.isFinite(rawPage) ? Math.max(1, rawPage) : 1
    const pageSize = 6

    if (!code) {
      return NextResponse.json({ error: '缺少编码参数' }, { status: 400 })
    }

    if (code.length > MAX_CODE_LENGTH) {
      return NextResponse.json({ error: '编码过长' }, { status: 400 })
    }

    const skip = (page - 1) * pageSize

    const [phrases, total] = await Promise.all([
      prisma.phrase.findMany({
        where: {
          status: 'Finish',
          code: {
            startsWith: code
          }
        },
        orderBy: { weight: 'asc' },
        skip,
        take: pageSize,
        select: {
          id: true,
          word: true,
          code: true,
          weight: true,
          type: true,
          remark: true,
          user: {
            select: {
              id: true,
              name: true,
              nickname: true
            }
          }
        }
      }),
      prisma.phrase.count({
        where: {
          status: 'Finish',
          code: {
            startsWith: code
          }
        }
      })
    ])

    const totalPages = Math.ceil(total / pageSize)

    return NextResponse.json({
      phrases,
      pagination: {
        page,
        pageSize,
        total,
        totalPages
      }
    })
  } catch (error) {
    console.error('Get phrases by code error:', error)
    return NextResponse.json({ error: '查询失败' }, { status: 500 })
  }
}
