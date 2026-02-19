import { headers } from 'next/headers'
import crypto from 'crypto'
import { NextResponse } from 'next/server'

/**
 * Verify bot API token from request headers
 */
export async function verifyBotToken(): Promise<boolean> {
  const headersList = await headers()
  const botToken = headersList.get('x-bot-token')

  const validToken = process.env.BOT_API_TOKEN

  if (!botToken || !validToken) {
    return false
  }

  // Constant-time comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(botToken),
      Buffer.from(validToken)
    )
  } catch {
    return false
  }
}

/**
 * Middleware for bot-only routes
 * Returns authorization status and error response if unauthorized
 */
export async function requireBotAuth(): Promise<{
  authorized: boolean
  response?: NextResponse
}> {
  const isValid = await verifyBotToken()

  if (!isValid) {
    return {
      authorized: false,
      response: NextResponse.json({ error: '未授权' }, { status: 401 })
    }
  }

  return { authorized: true }
}
