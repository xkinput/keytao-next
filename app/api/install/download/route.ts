import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/rateLimit'

const MAX_DOWNLOAD_URL_LENGTH = 2048

function clientKey(request: NextRequest) {
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwardedFor || request.headers.get('x-real-ip')?.trim() || 'unknown'
}

export async function GET(request: NextRequest) {
  try {
    const { allowed, retryAfterMs } = checkRateLimit(`install:download:${clientKey(request)}`)
    if (!allowed) {
      return NextResponse.json(
        { error: 'Too many requests', retryAfterMs },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) },
        }
      )
    }

    const url = request.nextUrl.searchParams.get('url')?.trim()

    if (!url) {
      return NextResponse.json(
        { error: 'Missing url parameter' },
        { status: 400 }
      )
    }

    if (url.length > MAX_DOWNLOAD_URL_LENGTH) {
      return NextResponse.json(
        { error: 'URL too long' },
        { status: 400 }
      )
    }

    let parsedUrl: URL
    try {
      parsedUrl = new URL(url)
    } catch {
      return NextResponse.json(
        { error: 'Invalid download URL' },
        { status: 400 }
      )
    }

    const allowedPrefixes = [
      'https://github.com/xkinput/KeyTao/releases/download/',
      'https://github.com/hugh7007/xmjd6-rere/releases/download/',
      'https://github.com/wzxmer/rime-txjx/releases/download/',
      'https://github.com/pingshunhuangalex/rime-keydo/releases/download/',
      'https://gitee.com/xkinput/KeyTao/releases/download/',
    ]
    if (!allowedPrefixes.some((prefix) => url.startsWith(prefix))) {
      return NextResponse.json(
        { error: 'Invalid download URL' },
        { status: 400 }
      )
    }

    const response = await fetch(parsedUrl.toString(), {
      headers: {
        'User-Agent': 'KeyTao-Next',
      },
    })

    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.status}`)
    }

    const upstreamLength = response.headers.get('Content-Length')
    const fileName = decodeURIComponent(parsedUrl.pathname.split('/').pop() || 'download.zip')
      .replace(/[^A-Za-z0-9._-]/g, '_')
      .slice(0, 120) || 'download.zip'

    return new NextResponse(response.body, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Access-Control-Allow-Origin': '*',
        ...(upstreamLength ? { 'Content-Length': upstreamLength } : {}),
      },
    })
  } catch (error) {
    console.error('Download error:', error)
    return NextResponse.json(
      { error: 'Failed to download file' },
      { status: 500 }
    )
  }
}
