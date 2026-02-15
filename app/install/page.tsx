'use client'

import { useState, useEffect } from 'react'
import { Button, Card, CardBody, Code, Divider, Listbox, ListboxItem, Progress, Alert } from '@heroui/react'
import { Folder, File, Apple, Monitor, Check, Download, AlertTriangle, RefreshCw } from 'lucide-react'
import JSZip from 'jszip'

type OSType = 'windows' | 'macos' | 'linux' | 'unknown'

interface FileItem {
  name: string
  kind: 'file' | 'directory'
}

interface ReleaseInfo {
  version: string
  name: string
  publishedAt: string
  body: string
  downloadUrls: {
    macos?: string
    windows?: string
    linux?: string
    android?: string
  }
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
  const [isInstalling, setIsInstalling] = useState(false)
  const [installProgress, setInstallProgress] = useState(0)
  const [installStatus, setInstallStatus] = useState<string>('')

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

    if (platform.includes('mac') || userAgent.includes('mac')) {
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

    const apiSupport = 'showDirectoryPicker' in window ? '✓ 支持' : '✗ 不支持'
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
      default:
        return '未知系统'
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

    const downloadUrl = releaseInfo.downloadUrls[osType as keyof typeof releaseInfo.downloadUrls]
    if (!downloadUrl) {
      setError(`没有找到适用于 ${getOSName()} 的安装包`)
      return
    }

    try {
      setIsInstalling(true)
      setInstallProgress(0)
      setInstallStatus('正在下载...')
      setError(null)

      // Download the file through proxy API to avoid CORS issues
      const response = await fetch(`/api/install/download?url=${encodeURIComponent(downloadUrl)}`)
      if (!response.ok) {
        throw new Error('下载失败')
      }

      const blob = await response.blob()
      setInstallProgress(50)
      setInstallStatus('正在解压...')

      // Unzip the file
      const zip = new JSZip()
      const zipContent = await zip.loadAsync(blob)

      // Check and request write permission for the directory
      try {
        type DirectoryHandleWithPermission = FileSystemDirectoryHandle & {
          queryPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<'granted' | 'denied' | 'prompt'>
          requestPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<'granted' | 'denied'>
        }
        const dirHandle = selectedDirectory as DirectoryHandleWithPermission

        // Try to check permission first
        const permission = await dirHandle.queryPermission?.({ mode: 'readwrite' })
        if (permission === 'prompt') {
          const newPermission = await dirHandle.requestPermission?.({ mode: 'readwrite' })
          if (newPermission !== 'granted') {
            throw new Error('需要目录写入权限才能安装')
          }
        } else if (permission === 'denied') {
          throw new Error('没有目录写入权限，请重新选择目录')
        }
      } catch (permErr) {
        // If permission API is not available, try to proceed anyway
        console.warn('Permission check not available, attempting to write:', permErr)
      }

      // Extract files
      const fileCount = Object.keys(zipContent.files).length
      let processedCount = 0

      for (const [relativePath, file] of Object.entries(zipContent.files)) {
        // Skip the root folder name (e.g., "keytao-mac/")
        const pathParts = relativePath.split('/')
        const actualPath = pathParts.slice(1).join('/')

        if (!actualPath) continue // Skip root folder itself

        if (file.dir) {
          // Create directory
          const dirParts = actualPath.split('/')
          let currentDir = selectedDirectory
          for (const part of dirParts) {
            if (part) {
              currentDir = await currentDir.getDirectoryHandle(part, { create: true })
            }
          }
        } else {
          // Write file
          const dirParts = actualPath.split('/')
          const fileName = dirParts.pop()!
          let currentDir = selectedDirectory

          // Create parent directories
          for (const part of dirParts) {
            if (part) {
              currentDir = await currentDir.getDirectoryHandle(part, { create: true })
            }
          }

          // Write file content
          const fileHandle = await currentDir.getFileHandle(fileName, { create: true })
          const writable = await fileHandle.createWritable()
          const content = await file.async('blob')
          await writable.write(content)
          await writable.close()
        }

        processedCount++
        setInstallProgress(50 + (processedCount / fileCount) * 50)
      }

      setInstallStatus('安装完成！')
      setInstallProgress(100)

      // Reload directory contents
      await loadDirectoryContents(selectedDirectory)

      setTimeout(() => {
        setIsInstalling(false)
        setInstallStatus('')
        setInstallProgress(0)
      }, 2000)
    } catch (err) {
      console.error('Installation error:', err)
      setError(err instanceof Error ? err.message : '安装失败')
      setIsInstalling(false)
      setInstallStatus('')
      setInstallProgress(0)
    }
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] p-8">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold">KeyTao 输入法方案安装</h1>
          <p className="text-default-500 mt-2">自动下载并安装最新版本的 KeyTao 输入法方案到您的 Rime 配置目录</p>
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
              <Divider className="my-4" />
              <div>
                <p className="text-sm text-default-600 mb-2">Rime 默认配置目录</p>
                <Code className="w-full" size="sm">{defaultPath}</Code>
              </div>
            </CardBody>
          </Card>

          {/* macOS Warning */}
          {osType === 'macos' && (
            <Alert
              color="warning"
              title="macOS 系统限制"
              description={
                <>
                  由于浏览器安全限制，<Code size="sm">~/Library</Code> 目录无法通过网页访问。
                  <strong>请选择其他目录</strong>（如 <Code size="sm">~/Documents/RimeSync</Code>）作为同步目录。
                </>
              }
            />
          )}

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
          />

          {/* Directory Selection Card */}
          <Card>
            <CardBody>
              <h2 className="text-xl font-semibold mb-4">选择安装目录</h2>
              <p className="text-sm text-default-600 mb-4">
                选择一个目录，KeyTao 输入法方案将被安装到该目录
              </p>

              {releaseInfo && (
                <Alert
                  color="success"
                  title={`最新版本: ${releaseInfo.version}`}
                  description={`发布时间: ${new Date(releaseInfo.publishedAt).toLocaleString('zh-CN')}`}
                  icon={<Download className="w-5 h-5" />}
                  className="mb-3"
                />
              )}

              <div className="flex gap-2 mb-4">
                <Button
                  color="primary"
                  size="lg"
                  onPress={selectDirectory}
                  isLoading={isLoading}
                  isDisabled={isLoading || isInstalling}
                  className="flex-1 sm:flex-none"
                >
                  {selectedDirectory ? '重新选择目录' : '选择安装目录'}
                </Button>

                {selectedDirectory && releaseInfo && (
                  <Button
                    color="danger"
                    size="lg"
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
                    <p className="text-xs font-semibold text-primary-800 mb-1.5">{installStatus}</p>
                    <Progress
                      value={installProgress}
                      color="primary"
                      size="sm"
                      className="mb-1"
                    />
                    <p className="text-xs text-primary-600">{Math.round(installProgress)}%</p>
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
                        onClick={refreshDirectory}
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

              {error && (
                <Alert
                  color="danger"
                  title="错误"
                  description={<div className="whitespace-pre-line">{error}</div>}
                />
              )}
            </CardBody>
          </Card>

          {/* Instructions Card */}
          <Card className="bg-primary-50 border-primary-200">
            <CardBody className="py-3">
              <h2 className="text-lg font-semibold mb-3 text-primary-900">📋 使用说明</h2>
              <div className="space-y-3 text-xs">
                <div>
                  <p className="font-semibold text-primary-800 mb-1.5">安装步骤：</p>
                  <ol className="list-decimal list-inside space-y-1 text-primary-700 ml-2">
                    <li>点击 <strong>选择安装目录</strong> 按钮，选择您的 Rime 配置目录
                    </li>
                    <li><span className="text-danger-600 font-bold">备份您的配置！</span>确保不会丢失个人数据</li>
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
                  <p className="font-semibold text-primary-800 mb-1.5">各平台 Rime 配置目录：</p>
                  <ul className="list-disc list-inside space-y-0.5 text-primary-700 ml-2">
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
