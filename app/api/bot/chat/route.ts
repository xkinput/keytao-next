import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'

const BOT_API_URL = process.env.BOT_API_URL || 'http://localhost:8080'
const BOT_API_KEY = process.env.BOT_API_KEY || ''

function botHeaders(): HeadersInit {
  return {
    'Content-Type': 'application/json',
    ...(BOT_API_KEY ? { Authorization: `Bearer ${BOT_API_KEY}` } : {}),
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const session = await getSession()
  const enrichedBody = session ? { ...body, user_id: String(session.id) } : body
  const res = await fetch(`${BOT_API_URL}/api/chat`, {
    method: 'POST',
    headers: botHeaders(),
    body: JSON.stringify(enrichedBody),
  })
  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}

export async function DELETE(req: NextRequest) {
  const body = await req.json()
  const res = await fetch(`${BOT_API_URL}/api/chat/history`, {
    method: 'DELETE',
    headers: botHeaders(),
    body: JSON.stringify(body),
  })
  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}
