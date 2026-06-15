'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Card, CardBody, CardHeader, Button, Input, Chip, Divider,
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, useDisclosure,
} from '@heroui/react'
import { Code, Plus, Trash2, Copy, Check, Key } from 'lucide-react'
import { useAPI, apiRequest } from '@/lib/hooks/useSWR'
import { useAuthStore } from '@/lib/store/auth'
import toast from 'react-hot-toast'

interface ApiKey {
  id: number
  name: string
  key: string
  enabled: boolean
  createdAt: string
  lastUsedAt: string | null
  requestCount: number
}

export default function DeveloperPage() {
  const router = useRouter()
  const user = useAuthStore(state => state.user)
  const { data, mutate } = useAPI<{ keys: ApiKey[] }>('/api/developer/keys')
  const { isOpen, onOpen, onClose } = useDisclosure()
  const [newKeyName, setNewKeyName] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [copiedId, setCopiedId] = useState<number | null>(null)

  if (!user) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center">
        <Card>
          <CardBody>
            <p className="text-center text-default-500">请先登录</p>
            <Button color="primary" className="mt-4" onPress={() => router.push('/login')}>
              前往登录
            </Button>
          </CardBody>
        </Card>
      </div>
    )
  }

  const handleCreate = async () => {
    if (!newKeyName.trim()) return
    setIsCreating(true)
    try {
      await apiRequest('/api/developer/keys', {
        method: 'POST',
        withAuth: true,
        body: { name: newKeyName.trim() },
      })
      await mutate()
      setNewKeyName('')
      onClose()
      toast.success('API Key 创建成功')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建失败')
    } finally {
      setIsCreating(false)
    }
  }

  const handleDelete = async (id: number) => {
    setDeletingId(id)
    try {
      await apiRequest(`/api/developer/keys/${id}`, { method: 'DELETE', withAuth: true })
      await mutate()
      toast.success('已删除')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败')
    } finally {
      setDeletingId(null)
    }
  }

  const handleCopy = async (key: ApiKey) => {
    await navigator.clipboard.writeText(key.key)
    setCopiedId(key.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const keys = data?.keys ?? []

  return (
    <div className="min-h-[calc(100vh-4rem)] p-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold">开发者 API</h1>
          <p className="text-default-500 mt-2">通过 API Key 调用词库查询接口，频率限制：2 次/秒</p>
        </div>

        <div className="grid gap-6">
          {/* API Keys */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-2">
                  <Key className="w-5 h-5" />
                  <h2 className="text-xl font-semibold">API Keys</h2>
                  <Chip size="sm" variant="flat">{keys.length} / 5</Chip>
                </div>
                <Button
                  size="sm"
                  color="primary"
                  startContent={<Plus className="w-4 h-4" />}
                  onPress={onOpen}
                  isDisabled={keys.length >= 5}
                >
                  新建
                </Button>
              </div>
            </CardHeader>
            <CardBody>
              {keys.length === 0 ? (
                <p className="text-center text-default-400 py-8">暂无 API Key，点击新建开始使用</p>
              ) : (
                <div className="space-y-3">
                  {keys.map((k) => (
                    <div key={k.id} className="border border-divider rounded-lg p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="font-medium">{k.name}</span>
                            <Chip size="sm" color={k.enabled ? 'success' : 'default'} variant="flat">
                              {k.enabled ? '启用' : '禁用'}
                            </Chip>
                          </div>
                          <div className="flex items-center gap-2">
                            <code className="text-xs bg-default-100 px-2 py-1 rounded font-mono truncate max-w-xs">
                              {k.key}
                            </code>
                            <Button
                              isIconOnly
                              size="sm"
                              variant="light"
                              onPress={() => handleCopy(k)}
                            >
                              {copiedId === k.id
                                ? <Check className="w-3 h-3 text-success" />
                                : <Copy className="w-3 h-3" />}
                            </Button>
                          </div>
                          <p className="text-xs text-default-400 mt-2">
                            创建于 {new Date(k.createdAt).toLocaleString('zh-CN')}
                            {k.lastUsedAt && ` · 最近使用 ${new Date(k.lastUsedAt).toLocaleString('zh-CN')}`}
                            {` · 调用 ${k.requestCount} 次`}
                          </p>
                        </div>
                        <Button
                          isIconOnly
                          size="sm"
                          color="danger"
                          variant="light"
                          isLoading={deletingId === k.id}
                          onPress={() => handleDelete(k.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          {/* Docs */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Code className="w-5 h-5" />
                <h2 className="text-xl font-semibold">接口文档</h2>
              </div>
            </CardHeader>
            <CardBody className="space-y-6">
              <p className="text-sm text-default-500">
                所有请求需在 Header 中携带 <code className="bg-default-100 px-1 rounded">X-API-Key: {'<your-key>'}</code>
              </p>

              <Divider />

              <ApiDoc
                method="GET"
                path="/api/v1/phrases/all"
                description="获取全量词条"
                params={[]}
                example={`curl -H "X-API-Key: kt_xxx" "/api/v1/phrases/all"`}
              />

              <Divider />

              <ApiDoc
                method="GET"
                path="/api/v1/phrases"
                description="查询词条列表"
                params={[
                  { name: 'search', desc: '搜索关键词（词或编码），可选' },
                  { name: 'type', desc: '类型过滤：Single / Phrase / Supplement / Symbol / Link / CSS / CSSSingle / English，可选' },
                  { name: 'page', desc: '页码，默认 1' },
                  { name: 'pageSize', desc: '每页数量，默认 20，最大 100' },
                ]}
                example={`curl -H "X-API-Key: kt_xxx" \\
  "/api/v1/phrases?search=中国&pageSize=10"`}
              />

              <Divider />

              <ApiDoc
                method="GET"
                path="/api/v1/phrases/by-code"
                description="按编码前缀查询词条"
                params={[
                  { name: 'code', desc: '编码前缀，必填' },
                  { name: 'page', desc: '页码，默认 1，每页 6 条' },
                ]}
                example={`curl -H "X-API-Key: kt_xxx" \\
  "/api/v1/phrases/by-code?code=gv"`}
              />

              <Divider />

              <ApiDoc
                method="GET"
                path="/api/v1/phrases/by-word"
                description="按词精确查询编码"
                params={[
                  { name: 'word', desc: '词，必填' },
                  { name: 'page', desc: '页码，默认 1，每页 6 条' },
                ]}
                example={`curl -H "X-API-Key: kt_xxx" \\
  "/api/v1/phrases/by-word?word=中国"`}
              />

              <Divider />

              <ApiDoc
                method="POST"
                path="/api/v1/phrases/by-code/batch"
                description="批量按编码精确查询词条，跨全部词库类型"
                params={[
                  { name: 'codes', desc: 'JSON body: 编码数组，最多 100 个' },
                ]}
                example={`curl -X POST -H "Content-Type: application/json" -H "X-API-Key: kt_xxx" \\
  -d '{"codes":["kls","kph","ssf"]}' \\
  "/api/v1/phrases/by-code/batch"`}
              />

              <Divider />

              <ApiDoc
                method="POST"
                path="/api/v1/phrases/by-word/batch"
                description="批量按词精确查询编码，跨全部词库类型"
                params={[
                  { name: 'words', desc: 'JSON body: 词条数组，最多 100 个' },
                ]}
                example={`curl -X POST -H "Content-Type: application/json" -H "X-API-Key: kt_xxx" \\
  -d '{"words":["北京","般若"]}' \\
  "/api/v1/phrases/by-word/batch"`}
              />

              <Divider />

              <ApiDoc
                method="POST / DELETE"
                path="/api/v1/pull-requests/batch-draft"
                description="维护当前 API Key 所属用户的个人 API 草稿批次"
                params={[
                  { name: 'items', desc: 'POST JSON body: 草稿 PR 条目数组' },
                  { name: 'batchId', desc: 'POST JSON body: 可选，追加到指定草稿批次' },
                  { name: 'ids', desc: 'DELETE JSON body: 要删除的草稿 PR ID 数组' },
                ]}
                example={`curl -X POST -H "Content-Type: application/json" -H "X-API-Key: kt_xxx" \\
  -d '{"items":[{"action":"Create","word":"示例词","code":"ulci","type":"Phrase","weight":100}]}' \\
  "/api/v1/pull-requests/batch-draft"`}
              />

              <Divider />

              <ApiDoc
                method="GET"
                path="/api/v1/infer"
                description="推断词条编码、推荐可用码并返回冲突信息"
                params={[
                  { name: 'word', desc: '词，必填' },
                  { name: 'code', desc: '待校验编码，可选' },
                ]}
                example={`curl -H "X-API-Key: kt_xxx" \\
  "/api/v1/infer?word=咋咋呼呼"`}
              />

              <Divider />

              <div>
                <h3 className="font-semibold mb-2">频率限制</h3>
                <p className="text-sm text-default-500">
                  每个 API Key 限制 <strong>2 次/秒</strong>。超出限制时返回 HTTP 429，
                  响应头 <code className="bg-default-100 px-1 rounded">Retry-After</code> 告知等待秒数。
                </p>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>

      {/* Create Modal */}
      <Modal isOpen={isOpen} onClose={onClose}>
        <ModalContent>
          <ModalHeader>新建 API Key</ModalHeader>
          <ModalBody>
            <Input
              label="名称"
              placeholder="例如：我的脚本"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              autoFocus
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onClose}>取消</Button>
            <Button
              color="primary"
              onPress={handleCreate}
              isLoading={isCreating}
              isDisabled={!newKeyName.trim()}
            >
              创建
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  )
}

function ApiDoc({
  method, path, description, params, example,
}: {
  method: string
  path: string
  description: string
  params: { name: string; desc: string }[]
  example: string
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Chip size="sm" color="primary" variant="flat">{method}</Chip>
        <code className="text-sm font-mono">{path}</code>
        <span className="text-sm text-default-500">— {description}</span>
      </div>
      <div className="space-y-1 pl-2">
        {params.map((p) => (
          <p key={p.name} className="text-xs text-default-500">
            <code className="bg-default-100 px-1 rounded">{p.name}</code> — {p.desc}
          </p>
        ))}
      </div>
      <pre className="text-xs bg-default-100 rounded-lg p-3 overflow-x-auto">{example}</pre>
    </div>
  )
}
