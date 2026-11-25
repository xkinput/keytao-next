import { NextRequest, NextResponse } from 'next/server'
import { extractKeytaoDownloadInfo } from '@/lib/releaseAssets'

interface PlatformRelease {
  version: string
  downloadUrl: string | null
  downloadUrls: Record<string, string>
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
    const { downloadUrl, downloadUrls } = extractKeytaoDownloadInfo(data.assets ?? [])
    return {
      version: data.tag_name ?? '',
      name: data.name ?? '',
      publishedAt: data.published_at ?? '',
      body: data.body ?? '',
      downloadUrl,
      downloadUrls,
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
    const { downloadUrl, downloadUrls } = extractKeytaoDownloadInfo(data.assets ?? [])
    return {
      version: data.tag_name ?? '',
      downloadUrl,
      downloadUrls,
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
      downloadUrl: github.downloadUrl,
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
      downloadUrl: gitee.downloadUrl,
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
    github: github
      ? { version: github.version, downloadUrl: github.downloadUrl, downloadUrls: github.downloadUrls }
      : null,
    gitee: gitee
      ? { version: gitee.version, downloadUrl: gitee.downloadUrl, downloadUrls: gitee.downloadUrls }
      : null,
  })
}
