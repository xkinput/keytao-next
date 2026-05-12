import { NextRequest, NextResponse } from 'next/server'

type PracticeSchemeKey = 'keytao' | 'xmjd' | 'txjx' | 'keydo'

interface ReleaseAssetSchemeSource {
  type: 'release-asset'
  owner: string
  repo: string
  assetName: string
  label: string
}

interface GithubMainArchiveSchemeSource {
  type: 'github-main-archive'
  owner: string
  repo: string
  label: string
}

type PracticeSchemeSource = ReleaseAssetSchemeSource | GithubMainArchiveSchemeSource

const PRACTICE_SCHEME_SOURCES: Record<PracticeSchemeKey, PracticeSchemeSource> = {
  keytao: {
    type: 'release-asset',
    owner: 'xkinput',
    repo: 'KeyTao',
    assetName: 'keytao-linux',
    label: '键道6',
  },
  xmjd: {
    type: 'release-asset',
    owner: 'hugh7007',
    repo: 'xmjd6-rere',
    assetName: 'xmjd6.zip',
    label: '星猫键道',
  },
  txjx: {
    type: 'release-asset',
    owner: 'wzxmer',
    repo: 'rime-txjx',
    assetName: 'txjx.zip',
    label: '天行键',
  },
  keydo: {
    type: 'github-main-archive',
    owner: 'pingshunhuangalex',
    repo: 'rime-keydo',
    label: '键道·我流',
  },
}

function isPracticeSchemeKey(value: string | null): value is PracticeSchemeKey {
  return value === 'keytao' || value === 'xmjd' || value === 'txjx' || value === 'keydo'
}

function findAsset(assets: { name: string; browser_download_url: string }[], source: ReleaseAssetSchemeSource) {
  const expectedName = source.assetName.toLowerCase()
  return assets.find((asset) => {
    const name = asset.name.toLowerCase()
    return expectedName.endsWith('.zip') ? name === expectedName : name.includes(expectedName) && name.endsWith('.zip')
  })
}

async function fetchGithubJson(url: string) {
  const response = await fetch(url, {
    headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'KeyTao-Next' },
    next: { revalidate: 600 },
  })

  if (!response.ok) return null
  return await response.json()
}

async function getGithubMainArchive(scheme: PracticeSchemeKey, source: GithubMainArchiveSchemeSource) {
  const repo = await fetchGithubJson(`https://api.github.com/repos/${source.owner}/${source.repo}`)
  if (!repo?.default_branch) {
    return NextResponse.json({ error: `Failed to fetch ${source.label} repository` }, { status: 502 })
  }

  const branch = String(repo.default_branch)
  const commit = await fetchGithubJson(`https://api.github.com/repos/${source.owner}/${source.repo}/commits/${encodeURIComponent(branch)}`)
  const sha = commit?.sha ? String(commit.sha) : ''
  if (!sha) {
    return NextResponse.json({ error: `Failed to fetch ${source.label} main commit` }, { status: 502 })
  }

  const shortSha = sha.slice(0, 12)
  return NextResponse.json({
    scheme,
    sourceType: source.type,
    label: source.label,
    version: shortSha,
    name: `${source.repo}@${shortSha}`,
    publishedAt: commit.commit?.committer?.date ?? commit.commit?.author?.date ?? '',
    downloadUrl: `https://github.com/${source.owner}/${source.repo}/archive/${sha}.zip`,
    assetName: `${source.repo}-${shortSha}.zip`,
  })
}

async function getReleaseAsset(scheme: PracticeSchemeKey, source: ReleaseAssetSchemeSource) {
  const release = await fetchGithubJson(`https://api.github.com/repos/${source.owner}/${source.repo}/releases/latest`)
  if (!release) {
    return NextResponse.json({ error: `Failed to fetch ${source.label} release` }, { status: 502 })
  }

  const asset = findAsset(release.assets ?? [], source)
  if (!asset) {
    return NextResponse.json({ error: `Latest release does not contain ${source.assetName}` }, { status: 404 })
  }

  return NextResponse.json({
    scheme,
    sourceType: source.type,
    label: source.label,
    version: release.tag_name ?? '',
    name: release.name ?? '',
    publishedAt: release.published_at ?? '',
    downloadUrl: asset.browser_download_url,
    assetName: asset.name,
  })
}

export async function GET(request: NextRequest) {
  const scheme = request.nextUrl.searchParams.get('scheme')
  if (!isPracticeSchemeKey(scheme)) {
    return NextResponse.json({ error: 'Invalid scheme' }, { status: 400 })
  }

  const source = PRACTICE_SCHEME_SOURCES[scheme]
  return source.type === 'release-asset'
    ? await getReleaseAsset(scheme, source)
    : await getGithubMainArchive(scheme, source)
}
