import { SignJWT, jwtVerify, errors } from 'jose'
import { headers } from 'next/headers'
import { prisma } from '@/lib/prisma'

const jwtSecret = process.env.JWT_SECRET

if (process.env.NODE_ENV === 'production' && !jwtSecret) {
  throw new Error('JWT_SECRET is required in production')
}
const secret = new TextEncoder().encode(jwtSecret || 'your-secret-key')

export interface JWTPayload {
  id: number
  name: string
  tv?: number
  jti?: string
  iat?: number
  exp?: number
}

export class AuthInfrastructureError extends Error {
  readonly name = 'AuthInfrastructureError'
}

const APP_WEBVIEW_GRANT_TYPE = 'keytao-app-webview+jwt'
export const APP_WEBVIEW_SESSION_PREFIX = 'keytao-app-webview:'

export async function signToken(
  payload: Omit<JWTPayload, 'iat' | 'exp' | 'jti'> & { tv: number },
  webviewSessionId?: string,
): Promise<string> {
  const token = new SignJWT(payload as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
  if (typeof webviewSessionId === 'string' && webviewSessionId.startsWith(APP_WEBVIEW_SESSION_PREFIX)) {
    token.setJti(webviewSessionId)
  }
  return await token.sign(secret)
}

export async function signAppWebviewGrant(session: JWTPayload, origin: string): Promise<string> {
  const expiresAt = Math.floor(Date.now() / 1000) + 60
  return await new SignJWT({ tv: session.tv ?? 0 })
    .setProtectedHeader({ alg: 'HS256', typ: APP_WEBVIEW_GRANT_TYPE })
    .setSubject(String(session.id))
    .setAudience(origin)
    .setIssuedAt()
    .setExpirationTime(Math.min(expiresAt, session.exp ?? expiresAt))
    .sign(secret)
}

export async function verifyAppWebviewGrant(grant: string, origin: string) {
  try {
    const { payload } = await jwtVerify(grant, secret, {
      algorithms: ['HS256'],
      audience: origin,
      typ: APP_WEBVIEW_GRANT_TYPE,
      requiredClaims: ['sub', 'iat', 'exp', 'tv'],
    })
    const id = Number(payload.sub)
    const tv = payload.tv
    if (!Number.isSafeInteger(id) || id <= 0
      || typeof tv !== 'number' || !Number.isSafeInteger(tv) || tv < 0) {
      return null
    }
    return { id, tv }
  } catch (error) {
    if (error instanceof errors.JOSEError) return null
    throw error
  }
}

export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] })
    // Legacy tokens remain valid at version zero until the first revocation.
    const tv = payload.tv === undefined ? 0 : payload.tv
    if (!Number.isSafeInteger(payload.id) || (payload.id as number) <= 0
      || typeof payload.name !== 'string' || !Number.isSafeInteger(tv) || (tv as number) < 0) {
      return null
    }
    const user = await prisma.user.findUnique({
      where: { id: payload.id as number },
      select: { status: true, tokenVersion: true },
    })
    if (!user || user.status !== 'ENABLE' || tv !== user.tokenVersion) return null
    return { ...payload, tv } as unknown as JWTPayload
  } catch (error) {
    if (error instanceof errors.JOSEError) return null
    throw new AuthInfrastructureError('Authentication unavailable', { cause: error })
  }
}

export async function getSession(): Promise<JWTPayload | null> {
  const headersList = await headers()
  const authHeader = headersList.get('authorization')

  if (!authHeader?.startsWith('Bearer ')) return null

  const token = authHeader.substring(7)
  return await verifyToken(token)
}

export function validatePassword(password: string): { valid: boolean; error?: string } {
  if (!password) {
    return { valid: false, error: '密码不能为空' }
  }
  
  if (password.length < 6) {
    return { valid: false, error: '密码长度至少为6个字符' }
  }
  
  return { valid: true }
}
