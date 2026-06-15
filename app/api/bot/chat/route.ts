import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { checkRateLimit } from '@/lib/rateLimit'

const BOT_API_URL = process.env.BOT_API_URL || 'http://localhost:8080'
const BOT_API_KEY = process.env.BOT_API_KEY || ''

function botHeaders(): HeadersInit {
  return {
    'Content-Type': 'application/json',
    ...(BOT_API_KEY ? { Authorization: `Bearer ${BOT_API_KEY}` } : {}),
  }
}

function checkBotChatRateLimit(userId: number) {
  const { allowed, retryAfterMs } = checkRateLimit(`bot-chat:${userId}`)
  if (allowed) {
    return null
  }

  return NextResponse.json(
    { error: '请求过于频繁', retryAfterMs },
    {
      status: 429,
      headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) },
    }
  )
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: '未登录' }, { status: 401 })
  }

  const rateLimitResponse = checkBotChatRateLimit(session.id)
  if (rateLimitResponse) {
    return rateLimitResponse
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 })
  }

  const sessionId = typeof body.session_id === 'string' ? body.session_id.trim() : ''
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!sessionId || !message) {
    return NextResponse.json({ error: '缺少必需参数' }, { status: 400 })
  }

  const res = await fetch(`${BOT_API_URL}/api/chat`, {
    method: 'POST',
    headers: botHeaders(),
    body: JSON.stringify({ message, session_id: sessionId, user_id: String(session.id) }),
  })
  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}

export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: '未登录' }, { status: 401 })
  }

  const rateLimitResponse = checkBotChatRateLimit(session.id)
  if (rateLimitResponse) {
    return rateLimitResponse
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 })
  }

  const sessionId = typeof body.session_id === 'string' ? body.session_id.trim() : ''
  if (!sessionId) {
    return NextResponse.json({ error: '缺少必需参数' }, { status: 400 })
  }

  const res = await fetch(`${BOT_API_URL}/api/chat/history`, {
    method: 'DELETE',
    headers: botHeaders(),
    body: JSON.stringify({ session_id: sessionId, user_id: String(session.id) }),
  })
  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}
