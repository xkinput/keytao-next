import { NextRequest, NextResponse } from 'next/server'

type ReleaseAsset = { name: string; browser_download_url: string }
type ReleaseSource = 'github' | 'gitee'

async function fetchGithubAssets(): Promise<ReleaseAsset[] | null> {
  try {
    const response = await fetch(
      'https://api.github.com/repos/xkinput/KeyTao/releases/latest',
      {
        headers: {
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'KeyTao-Next',
        },
        next: { revalidate: 600 },
      }
    )

    if (!response.ok) return null
    const data = await response.json()
    return data.assets || []
  } catch {
    return null
  }
}

async function fetchGiteeAssets(): Promise<ReleaseAsset[] | null> {
  try {
    const response = await fetch(
      'https://gitee.com/api/v5/repos/xkinput/KeyTao/releases/latest',
      {
        headers: {
          'User-Agent': 'KeyTao-Next',
        },
        next: { revalidate: 600 },
      }
    )

    if (!response.ok) return null
    const data = await response.json()
    return data.assets || []
  } catch {
    return null
  }
}

function getIosAsset(assets: ReleaseAsset[]): ReleaseAsset | undefined {
  return assets.find(asset => asset.name.toLowerCase().includes('keytao-ios-'))
}

export async function GET(req: NextRequest) {
  const sourceParam = req.nextUrl.searchParams.get('source') ?? req.nextUrl.searchParams.get('platform') ?? 'gitee'

  if (sourceParam !== 'github' && sourceParam !== 'gitee') {
    return NextResponse.json(
      { error: 'Invalid source, expected github or gitee' },
      { status: 400 }
    )
  }

  const source = sourceParam as ReleaseSource
  const assets = source === 'github'
    ? await fetchGithubAssets()
    : await fetchGiteeAssets()

  if (!assets) {
    return NextResponse.json(
      { error: `Failed to fetch ${source} release` },
      { status: 502 }
    )
  }

  const iosAsset = getIosAsset(assets)

  if (!iosAsset) {
    return NextResponse.json(
      { error: `No iOS asset found in latest ${source} release` },
      { status: 404 }
    )
  }

  return NextResponse.redirect(iosAsset.browser_download_url, { status: 302 })
}
