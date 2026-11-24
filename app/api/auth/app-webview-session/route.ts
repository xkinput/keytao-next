import { randomBytes, randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { APP_WEBVIEW_SESSION_PREFIX, getSession, signAppWebviewGrant, signToken, verifyAppWebviewGrant } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkRateLimit } from '@/lib/rateLimit'

const canonicalOrigin = 'https://keytao.rea.ink'
const websiteOrigins = new Set([canonicalOrigin, 'https://keytao.vercel.app'])
const sessionHeader = 'X-KeyTao-App-Session'
const authStorage = 'auth-storage'
const ownerStorage = 'keytao-app-webview-session'

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: NextRequest) {
  if (request.nextUrl.origin !== canonicalOrigin) {
    return errorResponse('不支持的网站域名', 400)
  }
  try {
    const session = await getSession()
    if (!session) return errorResponse('未登录', 401)
    const { allowed, retryAfterMs } = checkRateLimit(`auth:app-webview-session:${session.id}`)
    if (!allowed) {
      const response = errorResponse('请求过于频繁', 429)
      response.headers.set('Retry-After', String(Math.ceil(retryAfterMs / 1000)))
      return response
    }
    const body = await request.json().catch(() => null)
    const origin = body?.origin
    if (typeof origin !== 'string' || !websiteOrigins.has(origin)) {
      return errorResponse('不支持的网站域名', 400)
    }
    const grant = await signAppWebviewGrant(session, origin)
    return NextResponse.json({ grant }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return errorResponse('暂时无法同步网站登录', 503)
  }
}

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin
  const grant = request.headers.get(sessionHeader)
  if (!websiteOrigins.has(origin) || !grant || grant.length > 4096) {
    return errorResponse('网站登录凭据无效', 401)
  }
  if (grant === 'clear') return bootstrap(clearSessionScript)

  try {
    const identity = await verifyAppWebviewGrant(grant, origin)
    if (!identity) return errorResponse('网站登录凭据无效', 401)
    const user = await prisma.user.findUnique({
      where: { id: identity.id },
      select: { id: true, name: true, nickname: true, status: true, tokenVersion: true },
    })
    if (!user || user.status !== 'ENABLE' || user.tokenVersion !== identity.tv) {
      return errorResponse('网站登录凭据已失效', 401)
    }
    const jti = APP_WEBVIEW_SESSION_PREFIX + randomUUID()
    const profile = { id: user.id, name: user.name ?? '', nickname: user.nickname }
    const token = await signToken({ id: profile.id, name: profile.name, tv: identity.tv }, jti)
    const state = { token, user: profile, isAdmin: false, isRootAdmin: false, _adminChecked: false }
    return bootstrap(`
      localStorage.setItem(${scriptString(ownerStorage)}, ${scriptString(JSON.stringify({ id: user.id, jti }))})
      localStorage.setItem(${scriptString(authStorage)}, ${scriptString(JSON.stringify({ state, version: 0 }))})
    `)
  } catch {
    return errorResponse('暂时无法同步网站登录', 503)
  }
}

function scriptString(value: string) {
  return JSON.stringify(value).replaceAll('<', '\\u003c')
}

const clearSessionScript = `
  const ownerJson = localStorage.getItem(${scriptString(ownerStorage)})
  if (ownerJson) {
    const owner = JSON.parse(ownerJson)
    const state = JSON.parse(localStorage.getItem(${scriptString(authStorage)}))?.state
    // Manual logins, even for the same user, have a different token.
    const claims = state?.token?.split('.')[1]
    if (state?.user?.id === owner.id && claims
      && typeof owner.jti === 'string' && owner.jti.startsWith(${scriptString(APP_WEBVIEW_SESSION_PREFIX)})
      && JSON.parse(atob(claims.replaceAll('-', '+').replaceAll('_', '/'))).jti === owner.jti) {
      localStorage.removeItem(${scriptString(authStorage)})
    }
  }
  localStorage.removeItem(${scriptString(ownerStorage)})
`

function bootstrap(script: string) {
  const nonce = randomBytes(16).toString('base64')
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>KeyTao</title><script nonce="${nonce}">
      ${script}
      location.replace('/')
    </script>`,
    {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      },
    },
  )
}
