import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

const MAX_WORD_LENGTH = 20

// GET /api/phrases/by-word?word=xxx&page=1 - Get phrases by exact word match with pagination (public access)
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const word = searchParams.get('word')?.trim()
    const rawPage = parseInt(searchParams.get('page') || '1', 10)
    const page = Number.isFinite(rawPage) ? Math.max(1, rawPage) : 1
    const pageSize = 6

    if (!word) {
      return NextResponse.json({ error: '缺少词条参数' }, { status: 400 })
    }

    if (word.length > MAX_WORD_LENGTH) {
      return NextResponse.json({ error: '词条过长' }, { status: 400 })
    }

    const skip = (page - 1) * pageSize

    const [phrases, total] = await Promise.all([
      prisma.phrase.findMany({
        where: {
          status: 'Finish',
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
          status: 'Finish',
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
