'use client'

import { useState, useEffect } from 'react'
import { Button, Card, CardBody, Code, Listbox, ListboxItem, Progress, Alert, Link } from '@heroui/react'
import { Folder, File, Apple, Monitor, Check, Download, RefreshCw, Smartphone, TabletSmartphone, Lightbulb, Package, ClipboardList } from 'lucide-react'
import { unzip } from 'fflate'

const INSTALLER_RELEASES_URL = 'https://github.com/xkinput/keytao-installer/releases'

type OSType = 'windows' | 'macos' | 'linux' | 'android' | 'ios' | 'unknown'

interface FileItem {
  name: string
  kind: 'file' | 'directory'
}

type DownloadSource = 'github' | 'gitee'

interface PlatformRelease {
  version: string
  downloadUrls: Record<string, string>
}

interface ReleaseInfo {
  version: string
  name: string
  publishedAt: string
  body: string
  github: PlatformRelease | null
  gitee: PlatformRelease | null
}

interface RimeDownloadInfo {
  name: string
  description: string
  url: string
  installMethod: string
  command?: string
  commands?: string[]
  nixosNote?: string
  nixosUrl?: string
  configPath?: string
  appStoreNote?: string
}

export default function InstallPage() {
  const [osType, setOsType] = useState<OSType>('unknown')
  const [defaultPath, setDefaultPath] = useState<string>('')
  const [selectedDirectory, setSelectedDirectory] = useState<FileSystemDirectoryHandle | null>(null)
  const [files, setFiles] = useState<FileItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [browserInfo, setBrowserInfo] = useState<string>('')
  const [releaseInfo, setReleaseInfo] = useState<ReleaseInfo | null>(null)
  const [downloadSource, setDownloadSource] = useState<DownloadSource>('gitee')
  const [isInstalling, setIsInstalling] = useState(false)
  const [installProgress, setInstallProgress] = useState(0)
  const [installStatus, setInstallStatus] = useState<string>('')
  const [installSuccess, setInstallSuccess] = useState(false)
  const [hasWriteSupport, setHasWriteSupport] = useState(true)

  useEffect(() => {
    detectOS()
    detectBrowser()
    fetchLatestRelease()
  }, [])

  const detectOS = () => {
    const userAgent = window.navigator.userAgent.toLowerCase()
    const platform = window.navigator.platform.toLowerCase()

    let detectedOS: OSType = 'unknown'
    let path = ''

    if (userAgent.includes('android')) {
      detectedOS = 'android'
      path = '/sdcard/rime 或内部存储/rime'
    } else if (userAgent.includes('iphone') || userAgent.includes('ipad') || userAgent.includes('ipod')) {
      detectedOS = 'ios'
      path = '元书输入法 RimeUserData 目录'
    } else if (platform.includes('mac') || userAgent.includes('mac')) {
      detectedOS = 'macos'
      path = '~/Library/Rime'
    } else if (platform.includes('win') || userAgent.includes('win')) {
      detectedOS = 'windows'
      path = '%APPDATA%\\Rime'
    } else if (platform.includes('linux') || userAgent.includes('linux')) {
      detectedOS = 'linux'
      path = '~/.config/ibus/rime 或 ~/.config/fcitx/rime'
    }

    setOsType(detectedOS)
    setDefaultPath(path)
  }

  const detectBrowser = () => {
    const ua = window.navigator.userAgent
    let browser = 'Unknown'

    if (ua.includes('Edg/')) {
      const version = ua.match(/Edg\/(\d+)/)?.[1]
      browser = `Edge ${version}`
    } else if (ua.includes('Chrome/') && !ua.includes('Edg/')) {
      const version = ua.match(/Chrome\/(\d+)/)?.[1]
      browser = `Chrome ${version}`
    } else if (ua.includes('Safari/') && !ua.includes('Chrome')) {
      const version = ua.match(/Version\/(\d+)/)?.[1]
      browser = `Safari ${version}`
    } else if (ua.includes('Firefox/')) {
      const version = ua.match(/Firefox\/(\d+)/)?.[1]
      browser = `Firefox ${version}`
    }

    // Check File System API support with write capability
    let apiSupport = '✗ 不支持'
    let writeSupport = false
    if ('showDirectoryPicker' in window) {
      // Check if createWritable is available on FileSystemFileHandle
      writeSupport = typeof FileSystemFileHandle !== 'undefined' &&
        'createWritable' in FileSystemFileHandle.prototype
      apiSupport = writeSupport ? '完全支持 (读写)' : '部分支持 (仅读取)'
    }

    setHasWriteSupport(writeSupport)
    setBrowserInfo(`${browser} (File System API: ${apiSupport})`)
  }

  const getOSIcon = () => {
    switch (osType) {
      case 'macos':
        return <Apple className="w-8 h-8" />
      case 'windows':
        return <Monitor className="w-8 h-8" />
      case 'linux':
        return <Monitor className="w-8 h-8" />
      case 'android':
        return <Smartphone className="w-8 h-8" />
      case 'ios':
        return <TabletSmartphone className="w-8 h-8" />
      default:
        return null
    }
  }

  const getOSName = () => {
    switch (osType) {
      case 'macos':
        return 'macOS'
      case 'windows':
        return 'Windows'
      case 'linux':
        return 'Linux'
      case 'android':
        return 'Android'
      case 'ios':
        return 'iOS'
      default:
        return '未知系统'
    }
  }

  const getRimeDownloadInfo = (): RimeDownloadInfo | null => {
    switch (osType) {
      case 'macos':
        return {
          name: '鼠须管（Squirrel）',
          description: 'macOS 平台的 Rime 输入法',
          url: 'https://rime.im/download/#macOS',
          installMethod: 'dmg 安装包或通过 Homebrew 安装',
          command: 'brew install --cask squirrel'
        }
      case 'windows':
        return {
          name: '小狼毫（Weasel）',
          description: 'Windows 平台的 Rime 输入法',
          url: 'https://rime.im/download/#Windows',
          installMethod: 'exe 安装包',
        }
      case 'linux':
        return {
          name: 'iBus-Rime 或 Fcitx-Rime',
          description: 'Linux 平台的 Rime 输入法',
          url: 'https://rime.im/download/#Linux',
          installMethod: '通过包管理器安装',
          commands: [
            'sudo apt install ibus-rime  # Ubuntu/Debian',
            'sudo pacman -S ibus-rime    # Arch Linux',
            'sudo dnf install ibus-rime  # Fedora'
          ],
          nixosNote: '如果您使用 NixOS，可以选择专用的安装方式',
          nixosUrl: 'https://github.com/xkinput/KeyTao/blob/master/INSTALL_NIXOS.md'
        }
      case 'android':
        return {
          name: '同文输入法（Trime）',
          description: 'Android 平台的 Rime 输入法',
          url: 'https://github.com/osfans/trime',
          installMethod: '从 GitHub 下载 APK 安装包或通过 F-Droid 安装',
          configPath: '/sdcard/rime 或内部存储的 rime 目录'
        }
      case 'ios':
        return {
          name: '元书输入法',
          description: 'iOS 平台的 Rime 输入法，支持通过链接直接下载方案',
          url: 'https://apps.apple.com/cn/app/%E5%85%83%E4%B9%A6%E8%BE%93%E5%85%A5%E6%B3%95/id6744464701',
          installMethod: '从 App Store 下载安装',
          appStoreNote: '在 App Store 搜索「元书输入法」或点击链接下载安装',
          configPath: '元书输入法 → 输入方案 → 右上角「下载方案」'
        }
      default:
        return null
    }
  }

  const selectDirectory = async () => {
    // Prevent multiple calls while loading
    if (isLoading) return

    try {
      setError(null)
      setIsLoading(true)

      // Check browser support
      if (!('showDirectoryPicker' in window)) {
        setError('您的浏览器不支持文件系统访问 API。请使用最新版本的 Chrome、Edge 或其他基于 Chromium 的浏览器。')
        setIsLoading(false)
        return
      }

      const dirHandle = await window.showDirectoryPicker({
        mode: 'readwrite',
      })

      setSelectedDirectory(dirHandle)
      await loadDirectoryContents(dirHandle)
    } catch (err: unknown) {
      if (err instanceof Error) {
        if (err.name === 'AbortError') {
          // User cancelled, do nothing
          return
        }

        // Log detailed error info for debugging
        console.error('Directory selection error:', {
          name: err.name,
          message: err.message,
          stack: err.stack
        })

        // Provide detailed error message
        setError(
          `无法访问该目录\n` +
          `错误类型: ${err.name}\n` +
          `错误信息: ${err.message}\n\n` +
          `可能的原因：\n` +
          `• 浏览器安全限制（系统文件夹保护）\n` +
          `• 权限不足，请确定你已经在浏览器中授予了文件系统权限\n` +
          `• 目录不存在或已移动\n\n` +
          `建议：请尝试选择其他目录，或使用 GitHub 同步功能`
        )
      } else if (typeof err === 'object' && err !== null && 'name' in err && err.name !== 'AbortError') {
        setError(`选择目录时出错`)
      }
    } finally {
      setIsLoading(false)
    }
  }

  const loadDirectoryContents = async (dirHandle: FileSystemDirectoryHandle) => {
    try {
      setIsLoading(true)
      setError(null)

      const items: FileItem[] = []

      // Use type-safe method to iterate directory
      type DirectoryHandleWithValues = FileSystemDirectoryHandle & {
        values(): AsyncIterableIterator<FileSystemHandle>
      }

      const dirHandleWithValues = dirHandle as DirectoryHandleWithValues

      for await (const entry of dirHandleWithValues.values()) {
        items.push({
          name: entry.name,
          kind: entry.kind,
        })
      }

      // Sort: directories first, then files, alphabetically
      items.sort((a, b) => {
        if (a.kind !== b.kind) {
          return a.kind === 'directory' ? -1 : 1
        }
        return a.name.localeCompare(b.name)
      })

      setFiles(items)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '未知错误'
      setError(`读取目录内容时出错: ${message}`)
    } finally {
      setIsLoading(false)
    }
  }

  const getFileIcon = (item: FileItem) => {
    return item.kind === 'directory' ? (
      <Folder className="w-4 h-4 text-warning" />
    ) : (
      <File className="w-4 h-4 text-default-400" />
    )
  }

  const refreshDirectory = async () => {
    if (!selectedDirectory || isLoading) return
    await loadDirectoryContents(selectedDirectory)
  }

  const fetchLatestRelease = async () => {
    try {
      const response = await fetch('/api/install/latest-release')
      if (!response.ok) {
        throw new Error('Failed to fetch release info')
      }
      const data = await response.json()
      setReleaseInfo(data)
    } catch (err) {
      console.error('Error fetching latest release:', err)
    }
  }

  const downloadAndInstall = async () => {
    if (!selectedDirectory) {
      setError('请先选择一个目录')
      return
    }

    if (!releaseInfo) {
      setError('无法获取最新版本信息')
      return
    }

    const sourceData = downloadSource === 'gitee' ? releaseInfo.gitee : releaseInfo.github
    const downloadUrl = sourceData?.downloadUrls?.[osType]
    if (!downloadUrl) {
      setError(`没有找到适用于 ${getOSName()} 的安装包（${downloadSource === 'gitee' ? 'Gitee' : 'GitHub'}）`)
      return
    }

    try {
      setIsInstalling(true)
      setInstallProgress(0)
      setInstallStatus('正在下载...')
      setError(null)

      // Download through proxy with streaming progress
      const response = await fetch(`/api/install/download?url=${encodeURIComponent(downloadUrl)}`)
      if (!response.ok) {
        throw new Error('下载失败')
      }

      const contentLength = Number(response.headers.get('Content-Length') ?? 0)
      const reader = response.body!.getReader()
      const chunks: Uint8Array[] = []
      let receivedLength = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        receivedLength += value.length
        if (contentLength > 0) {
          const mb = (receivedLength / 1_048_576).toFixed(1)
          const totalMb = (contentLength / 1_048_576).toFixed(1)
          setInstallProgress(Math.round((receivedLength / contentLength) * 50))
          setInstallStatus(`正在下载... ${mb}MB / ${totalMb}MB`)
        }
      }

      const zipData = new Uint8Array(receivedLength)
      let pos = 0
      for (const chunk of chunks) { zipData.set(chunk, pos); pos += chunk.length }

      setInstallProgress(50)
      setInstallStatus('正在解压...')

      // Decompress with fflate (3-5x faster than JSZip)
      const unzipped = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
        unzip(zipData, (err, data) => { if (err) reject(err); else resolve(data) })
      })

      // Check and request write permission for the directory
      type DirectoryHandleWithPermission = FileSystemDirectoryHandle & {
        queryPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<'granted' | 'denied' | 'prompt'>
        requestPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<'granted' | 'denied'>
      }
      const dirHandle = selectedDirectory as DirectoryHandleWithPermission

      if (dirHandle.queryPermission) {
        const permission = await dirHandle.queryPermission({ mode: 'readwrite' })
        if (permission === 'prompt') {
          const newPermission = await dirHandle.requestPermission?.({ mode: 'readwrite' })
          if (newPermission !== 'granted') {
            throw new Error('需要目录写入权限才能安装，请在浏览器弹窗中允许访问')
          }
        } else if (permission === 'denied') {
          throw new Error('没有目录写入权限，请重新选择可写目录')
        }
      }

      // Separate file entries from directory-only entries
      const fileEntries = Object.entries(unzipped).filter(([path]) => !path.endsWith('/'))
      const fileCount = fileEntries.length

      // Helper: write a single file (with read-only fallback)
      const writeEntry = async (path: string, content: Uint8Array, idx: number) => {
        const parts = path.split('/')
        const fileName = parts.pop()!
        let currentDir = selectedDirectory
        for (const part of parts) {
          if (part) currentDir = await currentDir.getDirectoryHandle(part, { create: true })
        }

        const doWrite = async () => {
          const fileHandle = await currentDir.getFileHandle(fileName, { create: true })
          const writable = await fileHandle.createWritable()
          await writable.write(new Uint8Array(content))
          await writable.close()
        }

        try {
          await doWrite()
        } catch (writeErr) {
          const errName = writeErr instanceof Error ? writeErr.name : ''
          const errMsg = writeErr instanceof Error ? writeErr.message.toLowerCase() : ''
          const isReadOnly = errName === 'NoModificationAllowedError' || errName === 'NotAllowedError' || errMsg.includes('read-only')
          if (!isReadOnly) throw writeErr
          try {
            await currentDir.removeEntry(fileName)
            await doWrite()
          } catch {
            throw new Error(`文件 ${path} 为只读且无法覆盖，请检查目录权限或手动删除后重试`)
          }
        }

        setInstallProgress(50 + Math.round((idx / fileCount) * 50))
        setInstallStatus(`正在安装... ${idx}/${fileCount}: ${fileName}`)
      }

      // Write files in parallel batches of 8
      const BATCH = 8
      for (let i = 0; i < fileEntries.length; i += BATCH) {
        const batch = fileEntries.slice(i, i + BATCH)
        await Promise.all(batch.map(([path, content], j) => writeEntry(path, content, i + j + 1)))
      }

      setInstallStatus('安装完成！')
      setInstallProgress(100)

      await loadDirectoryContents(selectedDirectory)

      setInstallSuccess(true)
      setIsInstalling(false)
      setInstallStatus('')
      setInstallProgress(0)
    } catch (err) {
      console.error('Installation error:', err)
      setError(err instanceof Error ? err.message : '安装失败')
      setIsInstalling(false)
      setInstallStatus('')
      setInstallProgress(0)
      setInstallSuccess(false)
    }
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] p-8">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold">KeyTao 输入法方案安装</h1>
          <p className="text-default-500 mt-2">自动下载并安装最新版本的 KeyTao 输入法方案到您的 Rime 配置目录</p>
        </div>

        {/* Top-level installer banner */}
        <div className="bg-primary-50 border border-primary-200 rounded-xl p-5 mb-6 flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <Package className="w-10 h-10 text-primary flex-shrink-0" />
          <div className="flex-1">
            <p className="font-semibold text-lg text-primary-700">推荐使用键道安装更新程序</p>
            <p className="text-sm text-default-600 mt-0.5">
              支持 Windows / macOS / Linux，自动完成 Rime 平台与 KeyTao 方案的安装与更新，无需手动操作
            </p>
          </div>
          <Button
            as={Link}
            href={INSTALLER_RELEASES_URL}
            isExternal
            color="primary"
            size="md"
            startContent={<Download className="w-4 h-4" />}
            className="flex-shrink-0"
          >
            下载安装程序
          </Button>
        </div>

        <div className="grid gap-6">
          {/* System Info Card */}
          <Card>
            <CardBody>
              <h2 className="text-xl font-semibold mb-4">系统信息</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="flex items-center gap-3">
                  {getOSIcon()}
                  <div>
                    <p className="text-sm text-default-600">操作系统</p>
                    <p className="text-lg font-semibold">{getOSName()}</p>
                  </div>
                </div>
                <div>
                  <p className="text-sm text-default-600">浏览器支持</p>
                  <p className="text-sm font-medium text-default-800">{browserInfo}</p>
                </div>
              </div>
            </CardBody>
          </Card>

          {/* Rime Installation Guide Card */}
          {osType !== 'unknown' && (
            <Card>
              <CardBody>
                <div className="flex items-start gap-3 mb-3">
                  <div className="flex-1">
                    <h2 className="text-xl font-semibold mb-1">
                      步骤 1：安装 Rime 输入法
                    </h2>
                    <p className="text-sm text-default-600">
                      在安装 KeyTao 方案前，请确保您已安装对应系统的 Rime 输入法
                    </p>
                  </div>
                </div>

                {(() => {
                  const rimeInfo = getRimeDownloadInfo()
                  if (!rimeInfo) return null

                  return (
                    <div className="space-y-3">
                      <Alert
                        color="primary"
                        title={`为 ${getOSName()} 安装 ${rimeInfo.name}`}
                        description={rimeInfo.description}
                      />

                      <div className="bg-default-50 rounded-lg p-4 space-y-3 border border-default-200">
                        <div>
                          <p className="text-sm font-semibold mb-2">
                            📥 下载地址：
                          </p>
                          <Link
                            href={rimeInfo.url}
                            isExternal
                            showAnchorIcon
                            className="font-medium"
                          >
                            {rimeInfo.url}
                          </Link>
                        </div>

                        <div>
                          <p className="text-sm font-semibold mb-2">
                            💿 安装方式：
                          </p>
                          <p className="text-sm text-default-600 mb-2">
                            {rimeInfo.installMethod}
                          </p>

                          {rimeInfo.appStoreNote && (
                            <Alert
                              color="success"
                              description={rimeInfo.appStoreNote}
                              className="text-xs mb-2"
                            />
                          )}

                          {rimeInfo.command && (
                            <Code className="w-full" size="sm">
                              {rimeInfo.command}
                            </Code>
                          )}

                          {rimeInfo.commands && (
                            <div className="space-y-2">
                              {rimeInfo.commands.map((cmd, idx) => (
                                <Code key={idx} className="w-full block" size="sm">
                                  {cmd}
                                </Code>
                              ))}
                            </div>
                          )}
                        </div>

                        {rimeInfo.configPath && (
                          <div>
                            <p className="text-sm font-semibold mb-2">
                              📁 配置目录：
                            </p>
                            <Code className="w-full" size="sm">
                              {rimeInfo.configPath}
                            </Code>
                          </div>
                        )}

                        <Alert
                          color="warning"
                          description="安装完成后，请重启输入法或重新登录系统，确保输入法正常工作后再继续下一步。"
                          className="text-xs"
                        />

                        {rimeInfo.nixosNote && rimeInfo.nixosUrl && (
                          <Alert
                            color="primary"
                            title="🐧 NixOS 用户"
                            description={
                              <div>
                                <p className="mb-1">{rimeInfo.nixosNote}</p>
                                <Link
                                  href={rimeInfo.nixosUrl}
                                  isExternal
                                  showAnchorIcon
                                  className="text-sm font-medium"
                                >
                                  查看 NixOS 安装文档
                                </Link>
                              </div>
                            }
                            className="text-xs"
                          />
                        )}
                      </div>
                    </div>
                  )
                })()}
              </CardBody>
            </Card>
          )}

          {/* Directory Selection Card */}
          <Card>
            <CardBody>
              <h2 className="text-xl font-semibold mb-4">步骤 2：安装 KeyTao 方案</h2>

              {osType === 'ios' ? (
                <div className="space-y-4">
                  <Alert
                    color="primary"
                    title="iOS 平台 — 元书输入法"
                    description="iOS 不支持安装更新程序，请按以下步骤手动安装"
                  />
                  {releaseInfo && (
                    <Alert
                      color="success"
                      title={`最新 KeyTao 版本: ${releaseInfo.github?.version ?? releaseInfo.version}${releaseInfo.gitee ? ` · Gitee: ${releaseInfo.gitee.version}` : ''}`}
                      description={`发布时间: ${new Date(releaseInfo.publishedAt).toLocaleString('zh-CN')}`}
                      icon={<Download className="w-5 h-5" />}
                    />
                  )}
                  <div className="bg-default-50 rounded-lg p-5 border border-default-200">
                    <ol className="list-decimal list-inside space-y-2 text-sm text-default-700">
                      <li>
                        前往{' '}
                        <Link href="https://github.com/xkinput/KeyTao/releases/latest" isExternal showAnchorIcon className="text-sm">
                          GitHub Releases
                        </Link>
                        ，复制 <Code size="sm">keytao-ios-*.zip</Code> 的下载链接
                      </li>
                      <li>
                        打开{' '}
                        <Link href="https://apps.apple.com/app/id6744464701" isExternal showAnchorIcon className="text-sm">
                          元书输入法
                        </Link>
                        {' '}→ 输入方案 → 右上角「下载方案」→ 填写方案名称和下载链接 → 保存 → 点击下载
                      </li>
                      <li>返回「输入方案」→ 右上角「方案目录切换」→ 进入键道目录 → 右上角「打开」→ 部署 → 等待完成</li>
                    </ol>
                  </div>
                </div>
              ) : (osType === 'windows' || osType === 'macos') ? (
                <div className="space-y-4">
                  <Alert
                    color="warning"
                    title="系统限制"
                    description={
                      <span>
                        由于系统权限限制，浏览器无法直接写入{' '}
                        {osType === 'windows' && <><Code size="sm">%APPDATA%\Rime</Code> 目录</>}
                        {osType === 'macos' && <><Code size="sm">~/Library/Rime</Code> 目录</>}
                        ，请下载并运行键道安装更新程序完成安装与更新。
                      </span>
                    }
                  />
                  {releaseInfo && (
                    <Alert
                      color="success"
                      title={`最新 KeyTao 版本: ${releaseInfo.github?.version ?? releaseInfo.version}${releaseInfo.gitee ? ` · Gitee: ${releaseInfo.gitee.version}` : ''}`}
                      description={`发布时间: ${new Date(releaseInfo.publishedAt).toLocaleString('zh-CN')}`}
                      icon={<Download className="w-5 h-5" />}
                    />
                  )}
                  <div className="bg-default-50 rounded-lg p-5 border border-default-200">
                    <div className="flex items-start gap-4 mb-4">
                      <Package className="w-10 h-10 text-primary flex-shrink-0 mt-1" />
                      <div>
                        <p className="font-semibold text-lg">键道安装更新程序</p>
                        <p className="text-sm text-default-500 mt-1">
                          支持 Windows / macOS / Linux，自动完成 Rime 平台与 KeyTao 方案的安装与更新
                        </p>
                      </div>
                    </div>
                    <Button
                      as={Link}
                      href={INSTALLER_RELEASES_URL}
                      isExternal
                      color="primary"
                      size="lg"
                      startContent={<Download className="w-5 h-5" />}
                    >
                      前往下载安装程序
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Installation Warning */}
                  <Alert
                    color="danger"
                    title="重要提示"
                    description={
                      <>
                        点击安装将会<span className="font-semibold underline">覆盖选择目录中的所有同名文件</span>！
                        在执行安装操作前，请务必备份您的 Rime 配置目录，以免丢失个人配置和词库数据。
                      </>
                    }
                    className="mb-3"
                  />

                  {releaseInfo && (
                    <Alert
                      color="success"
                      title={`最新版本: ${releaseInfo.github?.version ?? releaseInfo.version}${releaseInfo.gitee ? ` · Gitee: ${releaseInfo.gitee.version}` : ''}`}
                      description={`发布时间: ${new Date(releaseInfo.publishedAt).toLocaleString('zh-CN')}`}
                      icon={<Download className="w-5 h-5" />}
                      className="mb-3"
                    />
                  )}

                  {releaseInfo && (releaseInfo.github || releaseInfo.gitee) && (
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-xs text-default-500">下载源：</span>
                      {(['github', 'gitee'] as const).map((src) => {
                        const info = src === 'github' ? releaseInfo.github : releaseInfo.gitee
                        if (!info) return null
                        return (
                          <button
                            key={src}
                            onClick={() => setDownloadSource(src)}
                            className={`px-3 py-1 text-xs rounded-full border transition-colors ${downloadSource === src
                              ? 'bg-primary text-white border-primary'
                              : 'bg-transparent text-default-500 border-default-300 hover:border-default-400'
                              }`}
                          >
                            {src === 'github' ? `GitHub ${info.version}` : `Gitee ${info.version}`}
                          </button>
                        )
                      })}
                    </div>
                  )}

                  {!hasWriteSupport && (
                    <>
                      <Alert
                        color="danger"
                        title="权限不完整，无法安装"
                        description={
                          <>
                            您的浏览器不支持文件写入功能。<br />
                            <strong>请使用支持 File System Access API 的浏览器</strong>（如 Chrome 86+、Edge 86+）或使用 <strong>GitHub 同步功能</strong>进行安装。
                          </>
                        }
                        className="mb-3"
                      />
                      <Alert
                        title={<span className="flex items-center gap-2"><Package className="w-4 h-4" /> 手动安装方式</span>}
                        description={
                          <div className="text-xs space-y-1">
                            <p>1. 前往 <Link href="https://github.com/xkinput/KeyTao/releases" isExternal showAnchorIcon className="text-xs">GitHub Releases</Link> 下载对应系统的压缩包</p>
                            <p>2. 解压压缩包到 Rime 配置目录中</p>
                            <p>3. 重新部署 Rime 输入法即可</p>
                          </div>
                        }
                        className="mb-3"
                      />
                    </>
                  )}

                  <p className="text-sm text-default-600 mb-2">
                    选择一个目录，KeyTao 输入法方案将被安装到该目录
                  </p>
                  <div className="mb-4">
                    <p className="text-xs text-default-500 mb-1">默认 Rime 配置目录：</p>
                    <Code className="w-full" size="sm">{defaultPath}</Code>
                  </div>

                  <div className="flex gap-2 mb-4">
                    <Button
                      color="primary"
                      onPress={selectDirectory}
                      isLoading={isLoading}
                      isDisabled={!hasWriteSupport || isLoading || isInstalling}
                      className="flex-1 sm:flex-none"
                    >
                      {selectedDirectory ? '重新选择目录' : '选择安装目录'}
                    </Button>

                    {selectedDirectory && releaseInfo && (
                      <Button
                        onPress={downloadAndInstall}
                        isLoading={isInstalling}
                        isDisabled={isLoading || isInstalling}
                        startContent={!isInstalling && <Download className="w-5 h-5" />}
                        className="flex-1 sm:flex-none"
                      >
                        {isInstalling ? '安装中...' : '立即安装'}
                      </Button>
                    )}
                  </div>

                  {isInstalling && (
                    <Card className="bg-primary-50 border-primary-200 mb-3">
                      <CardBody className="py-2">
                        <Progress
                          value={installProgress}
                          color="primary"
                          size="sm"
                          className="mb-1"
                          label={installStatus}
                          valueLabel={`${Math.round(installProgress)}%`}
                          showValueLabel
                        />
                      </CardBody>
                    </Card>
                  )}

                  {selectedDirectory && (
                    <Card className="bg-default-50 border-default-200 mb-4">
                      <CardBody>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Check className="w-5 h-5 text-success" />
                            <p className="text-sm font-semibold">
                              已选择同步目录: {selectedDirectory.name}
                            </p>
                          </div>
                          <Button
                            isIconOnly
                            size="sm"
                            variant="light"
                            onPress={refreshDirectory}
                            isLoading={isLoading}
                            isDisabled={isLoading || isInstalling}
                            title="刷新目录内容"
                          >
                            <RefreshCw className="w-4 h-4" />
                          </Button>
                        </div>
                        <div>
                          <p className="text-xs text-default-600 mb-2">
                            {`${files.length} 个项目`}
                          </p>
                          {files.length > 0 ? (
                            <>
                              <div className="max-h-48 overflow-y-auto border border-default-200 rounded-lg">
                                <Listbox aria-label="Directory contents" variant="flat">
                                  {files.slice(0, 30).map((item, index) => (
                                    <ListboxItem
                                      key={`${item.name}-${index}`}
                                      startContent={getFileIcon(item)}
                                      description={item.kind === 'directory' ? '文件夹' : '文件'}
                                      className="text-xs"
                                    >
                                      {item.name}
                                    </ListboxItem>
                                  ))}
                                </Listbox>
                              </div>
                              {files.length > 30 && (
                                <p className="text-xs text-default-400 mt-2">还有 {files.length - 30} 个项目...</p>
                              )}
                            </>
                          ) : (
                            <div className="border border-default-200 rounded-lg p-4 text-center">
                              <p className="text-sm text-default-400">该目录当前为空</p>
                            </div>
                          )}
                        </div>
                      </CardBody>
                    </Card>
                  )}

                  {installSuccess && (
                    <Alert
                      color="success"
                      title="安装完成！"
                      description={
                        <div>
                          <p className="mb-2">KeyTao 输入法方案已成功安装到所选目录。</p>
                          <p className="font-semibold">请前往输入法中点击&ldquo;重新部署&rdquo;即可使用。</p>
                        </div>
                      }
                      onClose={() => setInstallSuccess(false)}
                    />
                  )}

                  {error && (
                    <Alert
                      color="danger"
                      title="错误"
                      description={<div className="whitespace-pre-line">{error}</div>}
                    />
                  )}
                </>
              )}
            </CardBody>
          </Card>

          {/* Instructions Card */}
          <Card className="bg-primary-50 border-primary-200">
            <CardBody className="py-3">
              <h2 className="text-lg font-semibold mb-3 flex items-center gap-2"><ClipboardList className="w-5 h-5" /> 使用说明</h2>
              <div className="space-y-3 text-xs">
                <div>
                  <p className="font-semibold mb-1.5">安装步骤：</p>
                  <ol className="list-decimal list-inside space-y-1 text-default-600 ml-2">
                    <li>点击 <strong>选择安装目录</strong> 按钮，选择您的 Rime 配置目录
                    </li>
                    <li><span className="text-danger font-bold">备份您的配置！</span>确保不会丢失个人数据</li>
                    <li>点击 <strong>立即安装</strong> 按钮，系统将自动下载并解压最新版本</li>
                    <li>等待安装完成后，在 Rime 输入法中点击 <strong>重新部署</strong></li>
                    <li>部署完成后即可使用 KeyTao 输入法方案</li>
                  </ol>
                </div>

                <Alert
                  color="warning"
                  title="注意事项"
                  description={
                    <ul className="list-disc list-inside space-y-0.5 ml-2 text-xs">
                      <li>安装会覆盖目标目录中的同名文件</li>
                      <li>请务必提前备份您的个人配置和词库</li>
                      <li>如遇到权限问题，请选择有完整读写权限的目录</li>
                    </ul>
                  }
                />

                <div>
                  <p className="font-semibold mb-1.5">各平台 Rime 配置目录：</p>
                  <ul className="list-disc list-inside space-y-0.5 text-default-600 ml-2">
                    {osType === 'macos' && (
                      <>
                        <li><Code size="sm">~/Library/Rime/</Code> - 鼠须管标准目录（浏览器无法访问）</li>
                        <li><Code size="sm">~/Documents/Rime</Code> - 推荐使用的替代目录</li>
                        <li><Code size="sm">~/Desktop/Rime</Code> - 桌面目录（方便测试）</li>
                      </>
                    )}
                    {osType === 'windows' && (
                      <>
                        <li><Code size="sm">%APPDATA%\Rime</Code> - 小狼毫标准目录</li>
                        <li><Code size="sm">C:\Users\用户名\Documents\Rime</Code> - 替代目录</li>
                      </>
                    )}
                    {osType === 'linux' && (
                      <>
                        <li><Code size="sm">~/.config/ibus/rime/</Code> - iBus-Rime</li>
                        <li><Code size="sm">~/.config/fcitx/rime/</Code> - Fcitx-Rime</li>
                        <li><Code size="sm">~/.local/share/fcitx5/rime/</Code> - Fcitx5-Rime</li>
                      </>
                    )}
                    {osType === 'android' && (
                      <>
                        <li><Code size="sm">/sdcard/rime/</Code> - 同文输入法标准目录</li>
                        <li><Code size="sm">内部存储/rime/</Code> - 备用目录</li>
                        <li className="text-xs text-default-500 mt-1 flex items-center gap-1"><Lightbulb className="w-3 h-3" /> 在同文输入法设置中可以查看具体路径</li>
                      </>
                    )}
                    {osType === 'ios' && (
                      <>
                        <li className="font-semibold">元书输入法安装步骤：</li>
                        <li className="text-xs text-default-600 ml-2">1. 前往 GitHub Releases，复制 <Code size="sm">keytao-ios-*.zip</Code> 下载链接</li>
                        <li className="text-xs text-default-600 ml-2">2. 打开元书输入法 → 输入方案 → 右上角「下载方案」→ 填写方案名称和下载链接 → 保存 → 点击下载</li>
                        <li className="text-xs text-default-600 ml-2">3. 返回「输入方案」→ 右上角「方案目录切换」→ 进入键道目录 → 右上角「打开」→ 部署 → 等待完成</li>
                      </>
                    )}
                  </ul>
                </div>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  )
}

// TypeScript declarations for File System Access API
declare global {
  interface Window {
    showDirectoryPicker(options?: {
      mode?: 'read' | 'readwrite'
    }): Promise<FileSystemDirectoryHandle>
  }
}

export { }
