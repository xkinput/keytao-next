import { SignJWT, jwtVerify } from 'jose'
import { cookies, headers } from 'next/headers'

const secret = new TextEncoder().encode(process.env.JWT_SECRET || 'your-secret-key')

export interface JWTPayload {
  id: number
  name: string
  iat?: number
  exp?: number
}

export async function signToken(payload: Omit<JWTPayload, 'iat' | 'exp'>): Promise<string> {
  return await new SignJWT(payload as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secret)
}

export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret)
    return payload as JWTPayload
  } catch (error) {
    return null
  }
}

export async function getSession(): Promise<JWTPayload | null> {
  // Try to get token from Bearer header first
  const headersList = await headers()
  const authHeader = headersList.get('authorization')

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7)
    return await verifyToken(token)
  }

  // Fallback to cookie
  const cookieStore = await cookies()
  const token = cookieStore.get('token')?.value

  if (!token) return null

  return await verifyToken(token)
}

export async function setSession(token: string) {
  const cookieStore = await cookies()
  cookieStore.set('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: '/',
  })
}

export async function clearSession() {
  const cookieStore = await cookies()
  cookieStore.delete('token')
}
