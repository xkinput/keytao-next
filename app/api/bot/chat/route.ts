import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { checkRateLimit } from '@/lib/rateLimit'
import { BotIdentityConfigError, buildWebUserIdentityHeaders } from '@/lib/botWebIdentity'
import {
  InvalidJsonBodyError,
  readLimitedJson,
  RequestBodyTooLargeError,
} from '@/lib/limitedJsonBody'

const BOT_API_URL = (process.env.BOT_API_URL || 'http://localhost:8080').replace(/\/+$/, '')
const BOT_API_KEY = process.env.BOT_API_KEY || ''
const CHAT_PATH = '/api/chat'
const HISTORY_PATH = '/api/chat/history'
const CHAT_MAX_BODY_BYTES = 32 * 1024
const HISTORY_MAX_BODY_BYTES = 4 * 1024

function botHeaders(method: string, path: string, userId: number, rawBody: string): HeadersInit {
  return {
    'Content-Type': 'application/json',
    ...(BOT_API_KEY ? { Authorization: `Bearer ${BOT_API_KEY}` } : {}),
    ...buildWebUserIdentityHeaders({ method, path, userId, rawBody }),
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

  let body: unknown
  try {
    body = await readLimitedJson(req, CHAT_MAX_BODY_BYTES)
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError || error instanceof InvalidJsonBodyError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    throw error
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 })
  }
  if (Object.keys(body).some(key => !['message', 'session_id'].includes(key))) {
    return NextResponse.json({ error: '请求包含不支持的字段' }, { status: 400 })
  }
  const payload = body as Record<string, unknown>

  const sessionId = typeof payload.session_id === 'string' ? payload.session_id.trim() : ''
  const message = typeof payload.message === 'string' ? payload.message.trim() : ''
  const userId = String(session.id)
  if (!sessionId || sessionId.length > 128 || !message || message.length > 8000 || userId.length > 128) {
    return NextResponse.json({ error: '缺少必需参数' }, { status: 400 })
  }

  const rawBody = JSON.stringify({ message, session_id: sessionId, user_id: userId })
  let headers: HeadersInit
  try {
    headers = botHeaders('POST', CHAT_PATH, session.id, rawBody)
  } catch (error) {
    if (error instanceof BotIdentityConfigError) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    throw error
  }
  const res = await fetch(`${BOT_API_URL}${CHAT_PATH}`, {
    method: 'POST',
    headers,
    body: rawBody,
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

  let body: unknown
  try {
    body = await readLimitedJson(req, HISTORY_MAX_BODY_BYTES)
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError || error instanceof InvalidJsonBodyError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    throw error
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 })
  }
  if (Object.keys(body).some(key => key !== 'session_id')) {
    return NextResponse.json({ error: '请求包含不支持的字段' }, { status: 400 })
  }
  const payload = body as Record<string, unknown>

  const sessionId = typeof payload.session_id === 'string' ? payload.session_id.trim() : ''
  const userId = String(session.id)
  if (!sessionId || sessionId.length > 128 || userId.length > 128) {
    return NextResponse.json({ error: '缺少必需参数' }, { status: 400 })
  }

  const rawBody = JSON.stringify({ session_id: sessionId, user_id: userId })
  let headers: HeadersInit
  try {
    headers = botHeaders('DELETE', HISTORY_PATH, session.id, rawBody)
  } catch (error) {
    if (error instanceof BotIdentityConfigError) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    throw error
  }
  const res = await fetch(`${BOT_API_URL}${HISTORY_PATH}`, {
    method: 'DELETE',
    headers,
    body: rawBody,
  })
  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}
