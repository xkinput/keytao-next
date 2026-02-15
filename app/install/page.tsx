'use client'

import { useState, useEffect } from 'react'
import { Button, Card, CardBody, Code, Divider, Listbox, ListboxItem } from '@heroui/react'
import { Folder, File, Apple, Monitor, Check } from 'lucide-react'
import Navbar from '@/app/components/Navbar'

type OSType = 'windows' | 'macos' | 'linux' | 'unknown'

interface FileItem {
  name: string
  kind: 'file' | 'directory'
}

export default function InstallPage() {
  const [osType, setOsType] = useState<OSType>('unknown')
  const [defaultPath, setDefaultPath] = useState<string>('')
  const [selectedDirectory, setSelectedDirectory] = useState<FileSystemDirectoryHandle | null>(null)
  const [files, setFiles] = useState<FileItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [browserInfo, setBrowserInfo] = useState<string>('')

  useEffect(() => {
    detectOS()
    detectBrowser()
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
        mode: 'read',
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
          `• 权限不足\n` +
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

  return (
    <>
      <Navbar />
      <div className="min-h-[calc(100vh-4rem)] bg-linear-to-br from-background to-default-100 p-8">
        <div className="max-w-5xl mx-auto">
          <div className="mb-6">
            <h1 className="text-3xl font-bold">Rime 配置同步设置</h1>
            <p className="text-default-500 mt-2">通过选择一个同步目录来管理您的 Rime 配置文件</p>
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
              <Card className="bg-warning-50 border-2 border-warning-200">
                <CardBody>
                  <div className="flex gap-3">
                    <div className="text-warning-600 text-xl">⚠️</div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-warning-800 mb-2">macOS 系统限制</h3>
                      <p className="text-sm text-warning-700 mb-2">
                        由于浏览器安全限制，<Code size="sm">~/Library</Code> 目录无法通过网页访问。
                      </p>
                      <p className="text-sm text-warning-700">
                        <strong>请选择其他目录</strong>（如 <Code size="sm">~/Documents/RimeSync</Code>）作为同步目录。
                      </p>
                    </div>
                  </div>
                </CardBody>
              </Card>
            )}

            {/* Directory Selection Card */}
            <Card>
              <CardBody>
                <h2 className="text-xl font-semibold mb-4">选择同步目录</h2>
                <p className="text-sm text-default-600 mb-4">
                  选择一个您可以访问的目录用于同步 Rime 配置文件
                </p>

                <Button
                  color="primary"
                  size="lg"
                  onClick={selectDirectory}
                  isLoading={isLoading}
                  isDisabled={isLoading}
                  className="w-full sm:w-auto mb-4"
                >
                  {selectedDirectory ? '重新选择目录' : '选择同步目录'}
                </Button>

                {selectedDirectory && (
                  <Card className="bg-default-50 border-default-200 mb-4">
                    <CardBody>
                      <div className="flex items-center gap-2 mb-2">
                        <Check className="w-5 h-5 text-success" />
                        <p className="text-sm font-semibold">
                          已选择同步目录: {selectedDirectory.name}
                        </p>
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
                  <Card className="bg-danger-50 border-danger-200">
                    <CardBody>
                      <div className="text-sm text-danger whitespace-pre-line">
                        {error}
                      </div>
                    </CardBody>
                  </Card>
                )}
              </CardBody>
            </Card>

            {/* Instructions Card */}
            <Card className="bg-primary-50 border-primary-200">
              <CardBody>
                <h2 className="text-xl font-semibold mb-4 text-primary-900">📋 使用说明</h2>
                <div className="space-y-4 text-sm">
                  <div>
                    <p className="font-semibold text-primary-800 mb-2">如何使用同步功能：</p>
                    <ol className="list-decimal list-inside space-y-2 text-primary-700 ml-2">
                      <li>点击上方 <strong>选择同步目录</strong> 按钮，选择一个可访问的目录
                      </li>
                      <li>使用本系统的同步功能，将配置文件下载到选择的目录中</li>
                      <li>在鼠须管/Rime 输入法中，点击 <strong>用户设定</strong> → <strong>打开用户文件夹</strong></li>
                      <li>将同步目录中的配置文件手动复制到 Rime 用户文件夹中</li>
                      <li>在鼠须管/Rime 中点击 <strong>重新部署</strong> 使配置生效</li>
                    </ol>
                  </div>

                  <div>
                    <p className="font-semibold text-primary-800 mb-2">推荐的同步目录位置：</p>
                    <ul className="list-disc list-inside space-y-1 text-primary-700 ml-2">
                      {osType === 'macos' && (
                        <>
                          <li><Code size="sm">~/Documents/RimeSync</Code> - 文稿目录</li>
                          <li><Code size="sm">~/Desktop/RimeSync</Code> - 桌面目录</li>
                        </>
                      )}
                      {osType === 'windows' && (
                        <>
                          <li><Code size="sm">C:\Users\用户名\Documents\RimeSync</Code></li>
                          <li><Code size="sm">C:\Users\用户名\Desktop\RimeSync</Code></li>
                        </>
                      )}
                      {osType === 'linux' && (
                        <>
                          <li><Code size="sm">~/Documents/RimeSync</Code></li>
                          <li><Code size="sm">~/RimeSync</Code></li>
                        </>
                      )}
                      <li>任何您有完整读写权限的目录</li>
                    </ul>
                  </div>
                </div>
              </CardBody>
            </Card>
          </div>
        </div>
      </div>
    </>
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
