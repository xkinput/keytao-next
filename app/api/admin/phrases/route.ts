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

    const where = search
      ? {
        OR: [
          { word: { contains: search } },
          { code: { contains: search } },
        ],
      }
      : {}

    const [phrases, total] = await Promise.all([
      prisma.phrase.findMany({
        where,
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
        orderBy: { createAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.phrase.count({ where }),
    ])

    return NextResponse.json({ phrases, total })
  } catch (error) {
    console.error('Get phrases error:', error)
    return NextResponse.json(
      { error: '获取词条列表失败' },
      { status: 500 }
    )
  }
}
