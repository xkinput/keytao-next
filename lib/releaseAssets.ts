export interface ReleaseAssetLike {
  name: string
  browser_download_url: string
}

const LEGACY_PLATFORM_PREFIXES = [
  'keytao-mac',
  'keytao-macos',
  'keytao-win',
  'keytao-windows',
  'keytao-linux',
  'keytao-android',
  'keytao-ios',
]

export function isUniversalKeytaoZip(name: string): boolean {
  const lower = name.toLowerCase()
  if (!lower.endsWith('.zip') || !lower.startsWith('keytao-')) return false
  return !LEGACY_PLATFORM_PREFIXES.some((prefix) => lower.startsWith(prefix))
}

export function findUniversalKeytaoAsset<T extends ReleaseAssetLike>(
  assets: readonly T[]
): T | undefined {
  return assets.find((asset) => isUniversalKeytaoZip(asset.name))
}

export function extractKeytaoDownloadInfo(assets: readonly ReleaseAssetLike[]): {
  downloadUrl: string | null
  downloadUrls: Record<string, string>
} {
  const universal = findUniversalKeytaoAsset(assets)
  if (universal) {
    const url = universal.browser_download_url
    return {
      downloadUrl: url,
      downloadUrls: {
        macos: url,
        windows: url,
        linux: url,
        android: url,
        ios: url,
      },
    }
  }

  // Backward compatibility with legacy multi-platform releases (<= v1.3.34)
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

  return {
    downloadUrl: urls.linux ?? urls.macos ?? Object.values(urls)[0] ?? null,
    downloadUrls: urls,
  }
}
