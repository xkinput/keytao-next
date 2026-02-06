import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// GET /api/phrases/by-code?code=xxx - Get all phrases by code (public access)
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const code = searchParams.get('code')

    if (!code) {
      return NextResponse.json({ error: '缺少编码参数' }, { status: 400 })
    }

    const phrases = await prisma.phrase.findMany({
      where: { code },
      orderBy: { weight: 'asc' },
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
    })

    return NextResponse.json({ phrases })
  } catch (error) {
    console.error('Get phrases by code error:', error)
    return NextResponse.json({ error: '查询失败' }, { status: 500 })
  }
}
