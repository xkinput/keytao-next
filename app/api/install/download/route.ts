import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const url = request.nextUrl.searchParams.get('url')

    if (!url) {
      return NextResponse.json(
        { error: 'Missing url parameter' },
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

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'KeyTao-Next',
      },
    })

    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.status}`)
    }

    const upstreamLength = response.headers.get('Content-Length')

    return new NextResponse(response.body, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${url.split('/').pop()}"`,
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
