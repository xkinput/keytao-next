import { describe, expect, it } from 'vitest'
import {
  extractKeytaoDownloadInfo,
  findUniversalKeytaoAsset,
  isUniversalKeytaoZip,
} from './releaseAssets'

describe('KeyTao release asset matching', () => {
  it('recognizes universal keytao-v*.zip assets and ignores legacy platform zips', () => {
    expect(isUniversalKeytaoZip('keytao-v1.3.35.zip')).toBe(true)
    expect(isUniversalKeytaoZip('KeyTao-v2.0.0.zip')).toBe(true)
    expect(isUniversalKeytaoZip('keytao-linux-v1.3.34.zip')).toBe(false)
    expect(isUniversalKeytaoZip('keytao-mac-v1.3.34.zip')).toBe(false)
    expect(isUniversalKeytaoZip('keytao-windows-v1.3.34.zip')).toBe(false)
    expect(isUniversalKeytaoZip('keytao-android-v1.3.34.zip')).toBe(false)
    expect(isUniversalKeytaoZip('keytao-ios-v1.3.34.zip')).toBe(false)
    expect(isUniversalKeytaoZip('checksums.txt')).toBe(false)
  })

  it('maps a single universal zip to downloadUrl and every platform key for backward compatibility', () => {
    const universalUrl = 'https://github.com/xkinput/KeyTao/releases/download/v1.3.35/keytao-v1.3.35.zip'
    const info = extractKeytaoDownloadInfo([
      { name: 'keytao-v1.3.35.zip', browser_download_url: universalUrl },
    ])

    expect(info.downloadUrl).toBe(universalUrl)
    expect(info.downloadUrls).toEqual({
      macos: universalUrl,
      windows: universalUrl,
      linux: universalUrl,
      android: universalUrl,
      ios: universalUrl,
    })
  })

  it('falls back to legacy per-platform zips when no universal zip exists', () => {
    const assets = [
      { name: 'keytao-linux-v1.3.34.zip', browser_download_url: 'https://example/linux.zip' },
      { name: 'keytao-mac-v1.3.34.zip', browser_download_url: 'https://example/mac.zip' },
      { name: 'keytao-windows-v1.3.34.zip', browser_download_url: 'https://example/win.zip' },
      { name: 'keytao-android-v1.3.34.zip', browser_download_url: 'https://example/android.zip' },
      { name: 'keytao-ios-v1.3.34.zip', browser_download_url: 'https://example/ios.zip' },
      { name: 'checksums.txt', browser_download_url: 'https://example/checksums.txt' },
    ]

    expect(findUniversalKeytaoAsset(assets)).toBeUndefined()
    expect(extractKeytaoDownloadInfo(assets)).toEqual({
      downloadUrl: null,
      downloadUrls: {
        linux: 'https://example/linux.zip',
        macos: 'https://example/mac.zip',
        windows: 'https://example/win.zip',
        android: 'https://example/android.zip',
        ios: 'https://example/ios.zip',
      },
    })
  })
})
