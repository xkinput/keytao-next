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
  SelectItem
} from '@heroui/react'
import { useAPI } from '@/lib/hooks/useSWR'
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
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('')

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1) // Reset to first page when search changes
    }, 500)

    return () => clearTimeout(timer)
  }, [search])

  // Handle type filter change
  const handleTypeFilterChange = useCallback((keys: any) => {
    const selected = Array.from(keys)[0] as string
    setTypeFilter(selected || '')
    setPage(1)
  }, [])

  // Handle page change
  const handlePageChange = useCallback((newPage: number) => {
    setPage(newPage)
  }, [])

  const { data, isLoading, isValidating } = useAPI<{ phrases: Phrase[]; total: number }>(
    `/api/phrases?page=${page}&pageSize=20&search=${debouncedSearch}${typeFilter ? `&type=${typeFilter}` : ''}`,
    { keepPreviousData: true }
  )

  const phrases = data?.phrases || []
  const total = data?.total || 0
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
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold">词库管理</h1>
          <p className="text-default-500">共 {total} 条词条</p>
        </div>

        <div className="mb-4 flex gap-4">
          <Input
            placeholder="搜索词条或编码..."
            value={search}
            onValueChange={setSearch}
            onClear={() => setSearch('')}
            isClearable
            className="max-w-md"
            description={isSearching ? "正在输入..." : debouncedSearch ? `搜索: ${debouncedSearch}` : undefined}
          />
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
