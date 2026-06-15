import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, signToken } from '@/lib/auth'
import { checkRateLimit } from '@/lib/rateLimit'

function clientKey(request: NextRequest) {
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwardedFor || request.headers.get('x-real-ip')?.trim() || 'unknown'
}

export async function POST(request: NextRequest) {
  try {
    const { allowed, retryAfterMs } = checkRateLimit(`auth:refresh:${clientKey(request)}`)
    if (!allowed) {
      return NextResponse.json(
        { error: '请求过于频繁', retryAfterMs },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) },
        }
      )
    }

    const authHeader = request.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    const token = authHeader.substring(7)
    if (token.length > 4096) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    const payload = await verifyToken(token)
    if (!payload) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 })
    }

    const newToken = await signToken({ id: payload.id, name: payload.name })
    return NextResponse.json({ token: newToken })
  } catch (err) {
    console.error('Refresh token error:', err)
    return NextResponse.json({ error: '刷新失败' }, { status: 500 })
  }
}
