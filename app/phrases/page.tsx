'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
  Chip,
  Input,
  Pagination,
  Select,
  SelectItem,
  Button
} from '@/lib/heroui-compat'
import { Database, Download, RefreshCw, Search } from 'lucide-react'
import { useAPI, apiDownload } from '@/lib/hooks/useSWR'
import { useIsAdmin } from '@/lib/hooks/useAuth'
import { getPhraseTypeLabel, getPhraseTypeOptions, type PhraseType } from '@/lib/constants/phraseTypes'
import { PHRASE_STATUS_MAP, PHRASE_STATUS_COLOR_MAP } from '@/lib/constants/status'

interface Phrase {
  id: number
  word: string
  code: string
  type: string
  status: string
  weight: number
  remark: string | null
  createAt: string
}

export default function PhrasesPage() {
  const isAdmin = useIsAdmin()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<PhraseType | ''>('Phrase')
  const [isExporting, setIsExporting] = useState(false)

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1) // Reset to first page when search changes
    }, 500)

    return () => clearTimeout(timer)
  }, [search])

  // Handle type filter change
  const handleTypeFilterChange = useCallback((keys: 'all' | Set<React.Key>) => {
    const selected = Array.from(keys)[0] as PhraseType | ''
    setTypeFilter(selected || '')
    setPage(1)
  }, [])

  // Handle page change
  const handlePageChange = useCallback((newPage: number) => {
    setPage(newPage)
  }, [])

  // Handle export
  const handleExport = useCallback(async () => {
    try {
      setIsExporting(true)

      const response = await apiDownload('/api/phrases/export')

      // Get filename from Content-Disposition header
      const contentDisposition = response.headers.get('Content-Disposition')
      const filenameMatch = contentDisposition?.match(/filename="(.+)"/)
      const filename = filenameMatch ? filenameMatch[1] : 'keytao-phrases.zip'

      // Download file
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Export error:', error)
      alert('导出失败，请重试')
    } finally {
      setIsExporting(false)
    }
  }, [])

  const { data, isLoading, isValidating, mutate } = useAPI<{ phrases: Phrase[]; total: number; phrasesByType: Record<string, number> }>(
    `/api/phrases?page=${page}&pageSize=20&search=${debouncedSearch}${typeFilter ? `&type=${typeFilter}` : ''}`,
    { keepPreviousData: true }
  )

  const phrases = data?.phrases || []
  const total = data?.total || 0
  const phrasesByType = data?.phrasesByType || {}
  const isSearching = search !== debouncedSearch
  const showSkeleton = !data && isLoading

  const getTypeColor = (type: string) => {
    const colors: Record<string, "default" | "primary" | "secondary" | "success" | "warning" | "danger"> = {
      Single: 'primary',
      Phrase: 'success',
      Sentence: 'warning',
      Symbol: 'secondary',
      Link: 'secondary',
      Poem: 'secondary',
      Supplement: 'secondary',
      Other: 'default'
    }
    return colors[type] || 'default'
  }

  return (
    <div className="min-h-screen">
      <main className="app-container py-7">
        <div className="mb-6 flex flex-col gap-4 border-b border-default-200 pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-md bg-primary-50 px-2.5 py-1 text-xs font-semibold text-primary">
              <Database className="h-3.5 w-3.5" />
              公开词库
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">词库管理</h1>
            <p className="mt-1 text-sm text-default-500">共 {total} 条词条</p>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <Button
                isIconOnly
                variant="flat"
                size="sm"
                onPress={handleExport}
                isLoading={isExporting}
                title="导出为Rime词典（仅管理员）"
              >
                <Download className="w-4 h-4" />
              </Button>
            )}
            <Button
              isIconOnly
              variant="flat"
              size="sm"
              onPress={() => mutate()}
              isLoading={isValidating}
              title="刷新"
              aria-label="刷新词库"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div className="workbench-toolbar mb-5 flex flex-col gap-3 rounded-lg p-3 md:flex-row md:items-start">
          <Input
            placeholder="搜索词条或编码..."
            value={search}
            onValueChange={setSearch}
            onClear={() => setSearch('')}
            isClearable
            className="max-w-md"
            startContent={<Search className="h-4 w-4 text-default-400" />}
            description={isSearching ? "正在输入..." : debouncedSearch ? `搜索: ${debouncedSearch}` : undefined}
          />
          <div className="flex flex-col gap-1">
            <Select
              placeholder="筛选类型"
              className="max-w-xs"
              selectedKeys={typeFilter ? [typeFilter] : []}
              onSelectionChange={handleTypeFilterChange}
            >
              {[
                { value: '', label: '全部类型' },
                ...getPhraseTypeOptions()
              ].map((option) => (
                <SelectItem key={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </Select>
            {typeFilter && phrasesByType[typeFilter] !== undefined && (
              <p className="text-xs text-default-500 px-1">
                当前类型: {phrasesByType[typeFilter]} 条
              </p>
            )}
          </div>
        </div>

        {showSkeleton ? (
          <div className="flex justify-center items-center py-20">
            <div className="space-y-4 w-full">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="animate-pulse flex space-x-4">
                  <div className="flex-1 space-y-3 py-2">
                    <div className="h-4 bg-default-200 rounded w-3/4"></div>
                    <div className="h-4 bg-default-200 rounded w-1/2"></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <Table aria-label="词条列表">
            <TableHeader>
              <TableColumn>词</TableColumn>
              <TableColumn>编码</TableColumn>
              <TableColumn>类型</TableColumn>
              <TableColumn>权重</TableColumn>
              <TableColumn>状态</TableColumn>
              <TableColumn>备注</TableColumn>
            </TableHeader>
            <TableBody
              emptyContent="暂无数据"
            >
              {phrases.map((phrase) => (
                <TableRow key={phrase.id}>
                  <TableCell className="font-medium">{phrase.word}</TableCell>
                  <TableCell className="font-mono text-sm">{phrase.code}</TableCell>
                  <TableCell>
                    <Chip color={getTypeColor(phrase.type)} variant="flat" size="sm">
                      {getPhraseTypeLabel(phrase.type as PhraseType)}
                    </Chip>
                  </TableCell>
                  <TableCell>{phrase.weight}</TableCell>
                  <TableCell>
                    <Chip color={PHRASE_STATUS_COLOR_MAP[phrase.status] || 'default'} variant="flat" size="sm">
                      {PHRASE_STATUS_MAP[phrase.status] || phrase.status}
                    </Chip>
                  </TableCell>
                  <TableCell className="max-w-xs truncate">
                    {phrase.remark || '-'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {total > 20 && (
          <div className="flex justify-center mt-4">
            <Pagination
              total={Math.ceil(total / 20)}
              page={page}
              onChange={handlePageChange}
            />
          </div>
        )}
      </main>
    </div>
  )
}
