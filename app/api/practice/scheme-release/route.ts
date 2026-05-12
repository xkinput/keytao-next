import { NextRequest, NextResponse } from 'next/server'

type PracticeSchemeKey = 'keytao' | 'xmjd' | 'txjx'

interface PracticeSchemeSource {
  owner: string
  repo: string
  assetName: string
  label: string
}

const PRACTICE_SCHEME_SOURCES: Record<PracticeSchemeKey, PracticeSchemeSource> = {
  keytao: {
    owner: 'xkinput',
    repo: 'KeyTao',
    assetName: 'keytao-linux',
    label: '键道6',
  },
  xmjd: {
    owner: 'hugh7007',
    repo: 'xmjd6-rere',
    assetName: 'xmjd6.zip',
    label: '星猫键道',
  },
  txjx: {
    owner: 'wzxmer',
    repo: 'rime-txjx',
    assetName: 'txjx.zip',
    label: '天行键',
  },
}

function isPracticeSchemeKey(value: string | null): value is PracticeSchemeKey {
  return value === 'keytao' || value === 'xmjd' || value === 'txjx'
}

function findAsset(assets: { name: string; browser_download_url: string }[], source: PracticeSchemeSource) {
  const expectedName = source.assetName.toLowerCase()
  return assets.find((asset) => {
    const name = asset.name.toLowerCase()
    return expectedName.endsWith('.zip') ? name === expectedName : name.includes(expectedName) && name.endsWith('.zip')
  })
}

export async function GET(request: NextRequest) {
  const scheme = request.nextUrl.searchParams.get('scheme')
  if (!isPracticeSchemeKey(scheme)) {
    return NextResponse.json({ error: 'Invalid scheme' }, { status: 400 })
  }

  const source = PRACTICE_SCHEME_SOURCES[scheme]
  const response = await fetch(`https://api.github.com/repos/${source.owner}/${source.repo}/releases/latest`, {
    headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'KeyTao-Next' },
    next: { revalidate: 600 },
  })

  if (!response.ok) {
    return NextResponse.json({ error: `Failed to fetch ${source.label} release` }, { status: 502 })
  }

  const release = await response.json()
  const asset = findAsset(release.assets ?? [], source)
  if (!asset) {
    return NextResponse.json({ error: `Latest release does not contain ${source.assetName}` }, { status: 404 })
  }

  return NextResponse.json({
    scheme,
    label: source.label,
    version: release.tag_name ?? '',
    name: release.name ?? '',
    publishedAt: release.published_at ?? '',
    downloadUrl: asset.browser_download_url,
    assetName: asset.name,
  })
}
