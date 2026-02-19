import { NextRequest, NextResponse } from 'next/server'
import { verifyBotToken } from '@/lib/botAuth'
import { prisma } from '@/lib/prisma'
import type { UserFindResult } from '@/lib/types/platform'

/**
 * Find user by platform ID
 * POST /api/bot/user/find
 * Requires Bot token authentication
 */
export async function POST(request: NextRequest) {
  try {
    // Verify bot token
    if (!await verifyBotToken()) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const body = await request.json()
    const { platform, platformId } = body

    if (!platform || !platformId) {
      return NextResponse.json(
        { error: '缺少必需参数' },
        { status: 400 }
      )
    }

    if (!['qq', 'telegram'].includes(platform)) {
      return NextResponse.json(
        { error: '不支持的平台' },
        { status: 400 }
      )
    }

    // Find user by platform ID
    const fieldName = platform === 'qq' ? 'qqId' : 'telegramId'
    const user = await prisma.user.findFirst({
      where: {
        [fieldName]: platformId,
        status: 'ENABLE'
      },
      select: {
        id: true,
        name: true,
        nickname: true,
        email: true,
        createAt: true,
        roles: {
          select: {
            value: true,
            name: true
          }
        }
      }
    })

    if (!user) {
      return NextResponse.json<UserFindResult>(
        {
          found: false,
          message: '未找到绑定的用户'
        },
        { status: 404 }
      )
    }

    return NextResponse.json<UserFindResult>({
      found: true,
      user: {
        id: user.id,
        name: user.name,
        nickname: user.nickname,
        email: user.email,
        roles: user.roles,
        createAt: user.createAt
      }
    })
  } catch (error) {
    console.error('Find user error:', error)
    return NextResponse.json({ error: '查询失败' }, { status: 500 })
  }
}
