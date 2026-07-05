'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  Input,
  Select,
  SelectItem,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow,
  Textarea,
} from '@/lib/heroui-compat'
import { Download, FileDown, Pencil, Plus, RefreshCw, Save, Trash2, X } from 'lucide-react'
import { apiDownload, apiRequest, useAPI } from '@/lib/hooks/useSWR'
import { useAuthStore } from '@/lib/store/auth'
import { detectPhraseType, getDefaultWeight, getPhraseTypeLabel, getPhraseTypeOptions, type PhraseType } from '@/lib/constants/phraseTypes'

interface UserDictionaryEntry {
  id: number
  word: string
  code: string
  type: PhraseType
  weight: number
  remark: string | null
  replacePublic: boolean
  updateAt: string
}

interface UserDictionaryResponse {
  entries: UserDictionaryEntry[]
  total: number
}

interface UserDictionaryForm {
  word: string
  code: string
  type: PhraseType
  weight: string
  remark: string
  replacePublic: boolean
}

const emptyForm: UserDictionaryForm = {
  word: '',
  code: '',
  type: 'Phrase',
  weight: String(getDefaultWeight('Phrase')),
  remark: '',
  replacePublic: true,
}

function getTypeColor(type: PhraseType) {
  const colors: Record<string, 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'danger'> = {
    Single: 'primary',
    Phrase: 'success',
    Supplement: 'secondary',
    Symbol: 'warning',
    Link: 'secondary',
    CSS: 'default',
    CSSSingle: 'default',
    English: 'primary',
  }
  return colors[type] || 'default'
}

function downloadBlob(response: Response, fallbackName: string) {
  return response.blob().then((blob) => {
    const contentDisposition = response.headers.get('Content-Disposition')
    const filenameMatch = contentDisposition?.match(/filename="(.+)"/)
    const filename = filenameMatch ? filenameMatch[1] : fallbackName
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
  })
}

export default function UserDictionaryPage() {
  const router = useRouter()
  const user = useAuthStore((state) => state.user)
  const [form, setForm] = useState<UserDictionaryForm>(emptyForm)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isImportingDraft, setIsImportingDraft] = useState(false)
  const [isExporting, setIsExporting] = useState(false)

  const { data, isLoading, isValidating, mutate } = useAPI<UserDictionaryResponse>(
    user ? '/api/user/dictionary' : null
  )

  const entries = data?.entries ?? []
  const visibleEntries = useMemo(() => entries, [entries])

  useEffect(() => {
    if (!user) {
      const timer = setTimeout(() => router.push('/login'), 250)
      return () => clearTimeout(timer)
    }
  }, [router, user])

  function updateForm(patch: Partial<UserDictionaryForm>) {
    setForm((current) => ({ ...current, ...patch }))
  }

  function resetForm() {
    setForm(emptyForm)
    setEditingId(null)
    setError('')
    setMessage('')
  }

  function handleWordChange(word: string) {
    const type = detectPhraseType(word, form.code)
    updateForm({
      word,
      type,
      weight: editingId ? form.weight : String(getDefaultWeight(type)),
    })
  }

  function handleTypeChange(keys: 'all' | Set<React.Key>) {
    const selected = Array.from(keys)[0]
    const type = typeof selected === 'string' ? selected as PhraseType : 'Phrase'
    updateForm({ type, weight: String(getDefaultWeight(type)) })
  }

  async function handleSave() {
    setIsSaving(true)
    setError('')
    setMessage('')

    try {
      const payload = {
        word: form.word,
        code: form.code,
        type: form.type,
        weight: Number(form.weight),
        remark: form.remark,
        replacePublic: form.replacePublic,
      }
      const url = editingId ? `/api/user/dictionary/${editingId}` : '/api/user/dictionary'
      await apiRequest(url, {
        method: editingId ? 'PATCH' : 'POST',
        body: payload,
      })
      setMessage(editingId ? '已更新用户词条' : '已加入用户词库')
      resetForm()
      await mutate()
    } catch (err) {
      const nextError = err instanceof Error ? err.message : '保存失败'
      setError(nextError)
    } finally {
      setIsSaving(false)
    }
  }

  function handleEdit(entry: UserDictionaryEntry) {
    setEditingId(entry.id)
    setForm({
      word: entry.word,
      code: entry.code,
      type: entry.type,
      weight: String(entry.weight),
      remark: entry.remark ?? '',
      replacePublic: entry.replacePublic,
    })
    setError('')
    setMessage('')
  }

  async function handleDelete(entry: UserDictionaryEntry) {
    setError('')
    setMessage('')
    try {
      await apiRequest(`/api/user/dictionary/${entry.id}`, { method: 'DELETE' })
      setMessage(`已删除「${entry.word}」`)
      if (editingId === entry.id) resetForm()
      await mutate()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
    }
  }

  async function handleImportDraft() {
    setIsImportingDraft(true)
    setError('')
    setMessage('')
    try {
      const result = await apiRequest<{ createdOrUpdated: number; deleted: number; skipped: number }>(
        '/api/user/dictionary/from-draft',
        { method: 'POST', body: {} }
      )
      setMessage(`已从草稿导入 ${result.createdOrUpdated} 条，删除 ${result.deleted} 条，跳过 ${result.skipped} 条`)
      await mutate()
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入失败')
    } finally {
      setIsImportingDraft(false)
    }
  }

  async function handleExport() {
    setIsExporting(true)
    setError('')
    try {
      const response = await apiDownload('/api/user/dictionary/export?format=yaml')
      await downloadBlob(response, 'keytao.user.dict.yaml')
    } catch (err) {
      setError(err instanceof Error ? err.message : '导出失败')
    } finally {
      setIsExporting(false)
    }
  }

  if (!user) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center">
        <Card>
          <CardBody className="gap-4">
            <p className="text-center text-default-500">请先登录</p>
            <Button color="primary" onPress={() => router.push('/login')}>前往登录</Button>
          </CardBody>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold">我的词库</h1>
            <p className="text-default-500 mt-2">这些词只属于当前账号，App 同步后会写入 keytao.user.dict.yaml。</p>
          </div>
          <div className="flex items-center gap-2">
            <Chip variant="flat">共 {data?.total ?? 0} 条</Chip>
            <Button isIconOnly variant="flat" size="sm" onPress={() => mutate()} isLoading={isValidating} title="刷新">
              <RefreshCw className="w-4 h-4" />
            </Button>
            <Button variant="flat" size="sm" startContent={<FileDown className="w-4 h-4" />} onPress={handleImportDraft} isLoading={isImportingDraft}>
              从草稿导入
            </Button>
            <Button color="primary" variant="flat" size="sm" startContent={<Download className="w-4 h-4" />} onPress={handleExport} isLoading={isExporting}>
              导出
            </Button>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
          <Card>
            <CardHeader className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{editingId ? '编辑词条' : '新增词条'}</h2>
              {editingId && (
                <Button isIconOnly size="sm" variant="light" onPress={resetForm} aria-label="取消编辑">
                  <X className="w-4 h-4" />
                </Button>
              )}
            </CardHeader>
            <CardBody className="gap-4">
              <Input label="词" value={form.word} onValueChange={handleWordChange} isRequired />
              <Input label="编码" value={form.code} onValueChange={(code: string) => updateForm({ code })} isRequired />
              <Select label="类型" selectedKeys={[form.type]} onSelectionChange={handleTypeChange}>
                {getPhraseTypeOptions().map((option) => (
                  <SelectItem key={option.value}>{option.label}</SelectItem>
                ))}
              </Select>
              <Input label="权重" type="number" value={form.weight} onValueChange={(weight: string) => updateForm({ weight })} />
              <Textarea label="备注" value={form.remark} onValueChange={(remark: string) => updateForm({ remark })} minRows={2} />
              <Switch isSelected={form.replacePublic} onValueChange={(replacePublic: boolean) => updateForm({ replacePublic })}>
                同词默认覆盖公开词库
              </Switch>

              {error && <p className="text-sm text-danger">{error}</p>}
              {message && <p className="text-sm text-success">{message}</p>}

              <Button color="primary" onPress={handleSave} isLoading={isSaving} startContent={editingId ? <Save className="w-4 h-4" /> : <Plus className="w-4 h-4" />}>
                {editingId ? '保存修改' : '加入我的词库'}
              </Button>
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <Table aria-label="我的词库列表">
                <TableHeader>
                  <TableColumn>词</TableColumn>
                  <TableColumn>编码</TableColumn>
                  <TableColumn>类型</TableColumn>
                  <TableColumn>权重</TableColumn>
                  <TableColumn>覆盖</TableColumn>
                  <TableColumn>备注</TableColumn>
                  <TableColumn>操作</TableColumn>
                </TableHeader>
                <TableBody emptyContent={isLoading ? '加载中...' : '暂无用户词条'}>
                  {visibleEntries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="font-medium">{entry.word}</TableCell>
                      <TableCell className="font-mono text-sm">{entry.code}</TableCell>
                      <TableCell>
                        <Chip color={getTypeColor(entry.type)} variant="flat" size="sm">
                          {getPhraseTypeLabel(entry.type)}
                        </Chip>
                      </TableCell>
                      <TableCell>{entry.weight}</TableCell>
                      <TableCell>{entry.replacePublic ? '是' : '否'}</TableCell>
                      <TableCell className="max-w-xs truncate">{entry.remark || '-'}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button isIconOnly size="sm" variant="light" onPress={() => handleEdit(entry)} aria-label="编辑">
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button isIconOnly size="sm" variant="light" color="danger" onPress={() => handleDelete(entry)} aria-label="删除">
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardBody>
          </Card>
        </div>
      </main>
    </div>
  )
}
