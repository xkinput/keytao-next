import { NextRequest, NextResponse } from 'next/server'
import { verifyBotToken } from '@/lib/botAuth'
import { prisma } from '@/lib/prisma'
import type { BindResult } from '@/lib/types/platform'

/**
 * Verify link key and bind platform account
 * POST /api/auth/link/verify
 * Requires Bot token authentication
 */
export async function POST(request: NextRequest) {
  try {
    // Verify bot token
    if (!await verifyBotToken()) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const body = await request.json()
    const { key, platform, platformId } = body

    if (!key || !platform || !platformId) {
      return NextResponse.json<BindResult>(
        {
          success: false,
          message: '缺少必需参数'
        },
        { status: 400 }
      )
    }

    if (!['qq', 'telegram'].includes(platform)) {
      return NextResponse.json<BindResult>(
        {
          success: false,
          message: '不支持的平台'
        },
        { status: 400 }
      )
    }

    // Find link key
    const linkKey = await prisma.linkKey.findFirst({
      where: {
        key: key.toUpperCase(),
        isUsed: false
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            nickname: true,
            qqId: true,
            telegramId: true
          }
        }
      }
    })

    if (!linkKey) {
      return NextResponse.json<BindResult>(
        {
          success: false,
          message: '绑定码不存在或已使用'
        },
        { status: 404 }
      )
    }

    // Check if expired
    if (new Date() > linkKey.expiresAt) {
      await prisma.linkKey.delete({ where: { id: linkKey.id } })
      return NextResponse.json<BindResult>(
        {
          success: false,
          message: '绑定码已过期，请重新生成'
        },
        { status: 400 }
      )
    }

    // Check if this platform ID is already bound to another user
    const fieldName = platform === 'qq' ? 'qqId' : 'telegramId'
    const existingUser = await prisma.user.findFirst({
      where: {
        [fieldName]: platformId,
        id: { not: linkKey.userId }
      }
    })

    if (existingUser) {
      return NextResponse.json<BindResult>(
        {
          success: false,
          message: '该账号已被其他用户绑定'
        },
        { status: 400 }
      )
    }

    // Check if user already has a different account bound
    const currentBinding = linkKey.user[fieldName]
    if (currentBinding && currentBinding !== platformId) {
      return NextResponse.json<BindResult>(
        {
          success: false,
          message: `您已绑定${platform === 'qq' ? 'QQ' : 'Telegram'}账号：${currentBinding}，如需更换请先解绑`
        },
        { status: 400 }
      )
    }

    // Perform binding
    await prisma.$transaction([
      // Update user platform ID
      prisma.user.update({
        where: { id: linkKey.userId },
        data: {
          [fieldName]: platformId
        }
      }),
      // Mark key as used
      prisma.linkKey.update({
        where: { id: linkKey.id },
        data: {
          isUsed: true,
          usedAt: new Date(),
          platform,
          platformId
        }
      })
    ])

    return NextResponse.json<BindResult>({
      success: true,
      message: '绑定成功',
      userId: linkKey.user.id,
      userName: linkKey.user.name ?? undefined,
      userNickname: linkKey.user.nickname ?? undefined
    })
  } catch (error) {
    console.error('Verify link key error:', error)
    return NextResponse.json<BindResult>(
      {
        success: false,
        message: '验证失败，请稍后重试'
      },
      { status: 500 }
    )
  }
}
