import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// GET /api/phrases/by-word?word=xxx&page=1 - Get phrases by exact word match with pagination (public access)
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const word = searchParams.get('word')
    const page = parseInt(searchParams.get('page') || '1', 10)
    const pageSize = 6

    if (!word) {
      return NextResponse.json({ error: '缺少词条参数' }, { status: 400 })
    }

    if (page < 1) {
      return NextResponse.json({ error: '页码无效' }, { status: 400 })
    }

    const skip = (page - 1) * pageSize

    const [phrases, total] = await Promise.all([
      prisma.phrase.findMany({
        where: {
          word: word
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
          word: word
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
    console.error('Get phrases by word error:', error)
    return NextResponse.json({ error: '查询失败' }, { status: 500 })
  }
}
