import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyApiKey } from '@/lib/apiKeyAuth'

export async function GET(request: NextRequest) {
  const auth = await verifyApiKey()
  if (!auth.success) return auth.response

  const searchParams = request.nextUrl.searchParams
  const word = searchParams.get('word')
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
  const pageSize = 6

  if (!word) return NextResponse.json({ error: '缺少词参数' }, { status: 400 })

  const [phrases, total] = await Promise.all([
    prisma.phrase.findMany({
      where: { word, status: 'Finish' },
      select: { id: true, word: true, code: true, weight: true, type: true, remark: true },
      orderBy: { weight: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.phrase.count({ where: { word, status: 'Finish' } }),
  ])

  return NextResponse.json({
    phrases,
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  })
}
