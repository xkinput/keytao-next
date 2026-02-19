'use client'

import { useState, useEffect } from 'react'
import { Card, CardBody, CardHeader, Button, Input, Divider, Chip } from '@heroui/react'
import { MessageCircle, Key, Unlink } from 'lucide-react'
import { useAuthStore } from '@/lib/store/auth'

interface PlatformBindings {
  qqId: string | null
  telegramId: string | null
}

export function PlatformBindingCard() {
  const token = useAuthStore(state => state.token)
  const [linkKey, setLinkKey] = useState<string>('')
  const [expiresAt, setExpiresAt] = useState<Date | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string>('')
  const [success, setSuccess] = useState<string>('')
  const [timeLeft, setTimeLeft] = useState<string>('')
  const [bindings, setBindings] = useState<PlatformBindings | null>(null)
  const [isLoadingBindings, setIsLoadingBindings] = useState(true)
  const [isUnbinding, setIsUnbinding] = useState<string | null>(null)

  // Fetch current bindings
  useEffect(() => {
    const fetchBindings = async () => {
      if (!token) {
        setIsLoadingBindings(false)
        return
      }

      try {
        const res = await fetch('/api/auth/me', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        })

        if (res.ok) {
          const data = await res.json()
          setBindings({
            qqId: data.qqId || null,
            telegramId: data.telegramId || null
          })
        }
      } catch (err) {
        console.error('Fetch bindings error:', err)
      } finally {
        setIsLoadingBindings(false)
      }
    }

    fetchBindings()
  }, [token])

  const generateLinkKey = async () => {
    if (!token) {
      setError('请先登录')
      return
    }

    setError('')
    setSuccess('')
    setIsGenerating(true)
    try {
      const res = await fetch('/api/auth/link/generate', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || '生成失败')
      }

      const data = await res.json()
      setLinkKey(data.key)
      setExpiresAt(new Date(data.expiresAt))
      setSuccess('绑定码已生成')
    } catch (err) {
      console.error('Generate link key error:', err)
      setError(err instanceof Error ? err.message : '生成绑定码失败')
    } finally {
      setIsGenerating(false)
    }
  }

  const copyToClipboard = () => {
    if (!linkKey) return

    navigator.clipboard.writeText(`/bind ${linkKey}`)
    setSuccess('已复制到剪贴板')
  }

  const handleUnbind = async (platform: 'qq' | 'telegram') => {
    if (!token) {
      setError('请先登录')
      return
    }

    if (!confirm(`确定要解绑${platform === 'qq' ? 'QQ' : 'Telegram'}账号吗？`)) {
      return
    }

    setError('')
    setSuccess('')
    setIsUnbinding(platform)
    try {
      const res = await fetch('/api/auth/link/unbind', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ platform })
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || '解绑失败')
      }

      const data = await res.json()
      setSuccess(data.message)

      // Update local state
      setBindings(prev => prev ? {
        ...prev,
        [platform === 'qq' ? 'qqId' : 'telegramId']: null
      } : null)
    } catch (err) {
      console.error('Unbind error:', err)
      setError(err instanceof Error ? err.message : '解绑失败')
    } finally {
      setIsUnbinding(null)
    }
  }

  // Update countdown timer every second
  useEffect(() => {
    if (!expiresAt) {
      setTimeLeft('')
      return
    }

    const updateTimer = () => {
      const now = new Date()
      const diff = expiresAt.getTime() - now.getTime()
      const minutes = Math.floor(diff / 60000)
      const seconds = Math.floor((diff % 60000) / 1000)

      if (minutes <= 0 && seconds <= 0) {
        setTimeLeft('已过期')
        setLinkKey('') // Clear expired key
        setExpiresAt(null)
        return
      }

      setTimeLeft(`${minutes}分${seconds}秒`)
    }

    // Initial update
    updateTimer()

    // Update every second
    const timer = setInterval(updateTimer, 1000)

    return () => clearInterval(timer)
  }, [expiresAt])

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <MessageCircle className="w-5 h-5" />
          <h2 className="text-xl font-semibold">机器人账号绑定</h2>
        </div>
      </CardHeader>
      <CardBody>
        <div className="space-y-4">
          <p className="text-sm text-default-500">
            绑定 QQ 或 Telegram 账号后，可以通过机器人直接创建词条和 PR
          </p>

          <Divider />

          {/* Current Bindings Status */}
          {!isLoadingBindings && bindings && (
            <div className="space-y-3">
              <p className="text-sm font-medium">当前绑定状态：</p>
              <div className="space-y-2">
                {/* QQ Binding */}
                <div className="flex items-center justify-between p-3 bg-default-100 rounded-lg">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">QQ：</span>
                    {bindings.qqId ? (
                      <>
                        <Chip size="sm" color="success" variant="flat">
                          已绑定
                        </Chip>
                        <span className="text-sm text-default-600">{bindings.qqId}</span>
                      </>
                    ) : (
                      <Chip size="sm" color="default" variant="flat">
                        未绑定
                      </Chip>
                    )}
                  </div>
                  {bindings.qqId && (
                    <Button
                      size="sm"
                      color="danger"
                      variant="flat"
                      startContent={<Unlink className="w-3 h-3" />}
                      isLoading={isUnbinding === 'qq'}
                      isDisabled={isUnbinding !== null}
                      onClick={() => handleUnbind('qq')}
                    >
                      解绑
                    </Button>
                  )}
                </div>

                {/* Telegram Binding */}
                <div className="flex items-center justify-between p-3 bg-default-100 rounded-lg">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">Telegram：</span>
                    {bindings.telegramId ? (
                      <>
                        <Chip size="sm" color="success" variant="flat">
                          已绑定
                        </Chip>
                        <span className="text-sm text-default-600">{bindings.telegramId}</span>
                      </>
                    ) : (
                      <Chip size="sm" color="default" variant="flat">
                        未绑定
                      </Chip>
                    )}
                  </div>
                  {bindings.telegramId && (
                    <Button
                      size="sm"
                      color="danger"
                      variant="flat"
                      startContent={<Unlink className="w-3 h-3" />}
                      isLoading={isUnbinding === 'telegram'}
                      isDisabled={isUnbinding !== null}
                      onClick={() => handleUnbind('telegram')}
                    >
                      解绑
                    </Button>
                  )}
                </div>
              </div>

              <Divider />
            </div>
          )}

          {error && (
            <p className="text-sm text-danger">{error}</p>
          )}

          {success && (
            <p className="text-sm text-success">{success}</p>
          )}

          {!linkKey ? (
            <div className="space-y-3">
              <p className="text-sm text-default-600">
                点击生成绑定码，然后在机器人中发送命令完成绑定：
              </p>
              <div className="bg-default-100 p-3 rounded-lg">
                <code className="text-sm">
                  <span className="text-primary">/bind</span> [绑定码]
                </code>
              </div>
              <Button
                color="primary"
                onClick={generateLinkKey}
                isLoading={isGenerating}
                isDisabled={isGenerating}
                startContent={!isGenerating && <Key className="w-4 h-4" />}
              >
                {isGenerating ? '生成中...' : '生成绑定码'}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="text-sm text-default-600 mb-2">
                  您的绑定码：
                </p>
                <div className="flex items-center gap-2">
                  <Input
                    value={linkKey}
                    readOnly
                    className="font-mono text-lg"
                    size="lg"
                    classNames={{
                      input: "text-center font-bold tracking-wider"
                    }}
                  />
                  <Button
                    color="primary"
                    variant="flat"
                    onClick={copyToClipboard}
                  >
                    复制
                  </Button>
                </div>
              </div>

              {expiresAt && timeLeft && (
                <div className="bg-warning-50 border border-warning-200 rounded-lg p-3">
                  <p className="text-sm text-warning-800">
                    ⏰ 有效期：<strong>{timeLeft}</strong>
                  </p>
                </div>
              )}

              <Divider />

              <div className="space-y-2">
                <p className="text-sm font-medium">绑定步骤：</p>
                <ol className="text-sm text-default-600 space-y-1 list-decimal list-inside">
                  <li>打开 QQ 或 Telegram，找到键道机器人</li>
                  <li>发送：<code className="bg-default-100 px-2 py-0.5 rounded">/bind {linkKey}</code></li>
                  <li>收到确认消息后绑定完成</li>
                </ol>
              </div>

              <Button
                color="default"
                variant="flat"
                onClick={generateLinkKey}
                size="sm"
              >
                重新生成
              </Button>
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  )
}
