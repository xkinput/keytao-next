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
        next: { revalidate: 600 }, // cache for 10 minutes
      }
    )

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`)
    }

    const data = await response.json()

    const assets: { name: string; browser_download_url: string }[] = data.assets || []
    const iosAsset = assets.find((a) => a.name.includes('keytao-ios-'))

    if (!iosAsset) {
      return NextResponse.json(
        { error: 'No iOS asset found in latest release' },
        { status: 404 }
      )
    }

    return NextResponse.redirect(iosAsset.browser_download_url, { status: 302 })
  } catch (error) {
    console.error('Error fetching latest iOS release:', error)
    return NextResponse.json(
      { error: 'Failed to fetch latest release' },
      { status: 500 }
    )
  }
}
