import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const response = await fetch(
      'https://api.github.com/repos/xkinput/KeyTao/releases/latest',
      {
        headers: {
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'KeyTao-Next',
        },
        next: { revalidate: 3600 }, // cache for 1 hour
      }
    )

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`)
    }

    const data = await response.json()

    // Extract platform-specific download URLs
    const assets = data.assets || []
    const downloadUrls: Record<string, string> = {}

    for (const asset of assets) {
      if (asset.name.includes('keytao-mac-')) {
        downloadUrls.macos = asset.browser_download_url
      } else if (asset.name.includes('keytao-windows-')) {
        downloadUrls.windows = asset.browser_download_url
      } else if (asset.name.includes('keytao-linux-')) {
        downloadUrls.linux = asset.browser_download_url
      } else if (asset.name.includes('keytao-android-')) {
        downloadUrls.android = asset.browser_download_url
      }
    }

    return NextResponse.json({
      version: data.tag_name,
      name: data.name,
      publishedAt: data.published_at,
      body: data.body,
      downloadUrls,
    })
  } catch (error) {
    console.error('Error fetching latest release:', error)
    return NextResponse.json(
      { error: 'Failed to fetch latest release' },
      { status: 500 }
    )
  }
}
