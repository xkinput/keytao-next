import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * Unbind platform account
 * POST /api/auth/link/unbind
 * Requires JWT authentication
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const body = await request.json()
    const { platform } = body

    if (!platform || !['qq', 'telegram'].includes(platform)) {
      return NextResponse.json(
        { error: '无效的平台参数' },
        { status: 400 }
      )
    }

    const fieldName = platform === 'qq' ? 'qqId' : 'telegramId'

    // Check if user has this platform bound
    const user = await prisma.user.findUnique({
      where: { id: session.id },
      select: {
        qqId: true,
        telegramId: true
      }
    })

    if (!user || !user[fieldName]) {
      return NextResponse.json(
        { error: `未绑定${platform === 'qq' ? 'QQ' : 'Telegram'}账号` },
        { status: 400 }
      )
    }

    // Unbind platform account
    await prisma.user.update({
      where: { id: session.id },
      data: {
        [fieldName]: null
      }
    })

    return NextResponse.json({
      success: true,
      message: `${platform === 'qq' ? 'QQ' : 'Telegram'}账号已解绑`
    })
  } catch (error) {
    console.error('Unbind platform error:', error)
    return NextResponse.json(
      { error: '解绑失败，请稍后重试' },
      { status: 500 }
    )
  }
}
