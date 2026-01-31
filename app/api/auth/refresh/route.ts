import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, signToken } from '@/lib/auth'

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    const token = authHeader.substring(7)
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
