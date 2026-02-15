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

    // Validate that the URL is from GitHub releases
    if (!url.startsWith('https://github.com/xkinput/KeyTao/releases/download/')) {
      return NextResponse.json(
        { error: 'Invalid download URL' },
        { status: 400 }
      )
    }

    // Fetch the file from GitHub
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'KeyTao-Next',
      },
    })

    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.status}`)
    }

    // Stream the response back to the client
    const blob = await response.blob()

    return new NextResponse(blob, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${url.split('/').pop()}"`,
        'Access-Control-Allow-Origin': '*',
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
