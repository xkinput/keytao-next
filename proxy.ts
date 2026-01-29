import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getSession } from './lib/auth'

const publicPaths = ['/', '/login', '/register', '/test']

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Check if path is public
  const isPublicPath = publicPaths.some(path => pathname.startsWith(path))

  // Get session
  const session = await getSession()

  // Redirect to login if not authenticated and trying to access protected route
  if (!session && !isPublicPath) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Redirect to home if authenticated and trying to access auth pages
  if (session && (pathname.startsWith('/login') || pathname.startsWith('/register'))) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
}
