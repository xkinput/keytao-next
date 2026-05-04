import { NextRequest, NextResponse } from 'next/server'

interface PlatformRelease {
  version: string
  downloadUrls: Record<string, string>
}

function extractDownloadUrls(assets: { name: string; browser_download_url: string }[]): Record<string, string> {
  const urls: Record<string, string> = {}
  for (const asset of assets) {
    const n = asset.name.toLowerCase()
    if (n.includes('keytao-mac') || n.includes('keytao-macos')) {
      urls.macos = asset.browser_download_url
    } else if (n.includes('keytao-win') || n.includes('keytao-windows')) {
      urls.windows = asset.browser_download_url
    } else if (n.includes('keytao-linux')) {
      urls.linux = asset.browser_download_url
    } else if (n.includes('keytao-android')) {
      urls.android = asset.browser_download_url
    } else if (n.includes('keytao-ios')) {
      urls.ios = asset.browser_download_url
    }
  }
  return urls
}

async function fetchGithubRelease(): Promise<PlatformRelease & { name: string; publishedAt: string; body: string } | null> {
  try {
    const res = await fetch(
      'https://api.github.com/repos/xkinput/KeyTao/releases/latest',
      {
        headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'KeyTao-Next' },
        next: { revalidate: 600 },
      }
    )
    if (!res.ok) return null
    const data = await res.json()
    return {
      version: data.tag_name ?? '',
      name: data.name ?? '',
      publishedAt: data.published_at ?? '',
      body: data.body ?? '',
      downloadUrls: extractDownloadUrls(data.assets ?? []),
    }
  } catch {
    return null
  }
}

async function fetchGiteeRelease(): Promise<PlatformRelease | null> {
  try {
    const res = await fetch(
      'https://gitee.com/api/v5/repos/xkinput/KeyTao/releases/latest',
      {
        headers: { 'User-Agent': 'KeyTao-Next' },
        next: { revalidate: 600 },
      }
    )
    if (!res.ok) return null
    const data = await res.json()
    return {
      version: data.tag_name ?? '',
      downloadUrls: extractDownloadUrls(data.assets ?? []),
    }
  } catch {
    return null
  }
}

export async function GET(req: NextRequest) {
  const platform = req.nextUrl.searchParams.get('platform')

  if (platform === 'github') {
    const github = await fetchGithubRelease()
    if (!github) {
      return NextResponse.json({ error: 'Failed to fetch GitHub release' }, { status: 502 })
    }
    return NextResponse.json({
      version: github.version,
      name: github.name,
      publishedAt: github.publishedAt,
      body: github.body,
      downloadUrls: github.downloadUrls,
    })
  }

  if (platform === 'gitee') {
    const gitee = await fetchGiteeRelease()
    if (!gitee) {
      return NextResponse.json({ error: 'Failed to fetch Gitee release' }, { status: 502 })
    }
    return NextResponse.json({
      version: gitee.version,
      downloadUrls: gitee.downloadUrls,
    })
  }

  // No platform param: fetch both in parallel
  const [github, gitee] = await Promise.all([fetchGithubRelease(), fetchGiteeRelease()])

  if (!github && !gitee) {
    return NextResponse.json({ error: 'Failed to fetch release info' }, { status: 502 })
  }

  return NextResponse.json({
    version: gitee?.version ?? github?.version ?? '',
    name: github?.name ?? '',
    publishedAt: github?.publishedAt ?? '',
    body: github?.body ?? '',
    github: github ? { version: github.version, downloadUrls: github.downloadUrls } : null,
    gitee: gitee ? { version: gitee.version, downloadUrls: gitee.downloadUrls } : null,
  })
}
