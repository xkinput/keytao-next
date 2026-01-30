'use client'

import { useState, useEffect } from 'react'
import {
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
  Chip,
  Spinner,
  Input,
  Pagination,
  Select,
  SelectItem
} from '@heroui/react'
import Navbar from '@/app/components/Navbar'
import { useAPI } from '@/lib/hooks/useSWR'
import { getPhraseTypeLabel, type PhraseType } from '@/lib/constants/phraseTypes'

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

// Status label mapping
const getStatusLabel = (status: string) => {
  const labels: Record<string, string> = {
    Finish: '已完成',
    Draft: '草稿',
    Reject: '已拒绝'
  }
  return labels[status] || status
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

  const { data, isLoading, isValidating } = useAPI<{ phrases: Phrase[]; total: number }>(
    `/api/admin/phrases?page=${page}&pageSize=20&search=${debouncedSearch}${typeFilter ? `&type=${typeFilter}` : ''}`,
    { keepPreviousData: true }
  )

  const phrases = data?.phrases || []
  const total = data?.total || 0
  const isSearching = search !== debouncedSearch
  const isFirstLoad = !data && isLoading

  const getTypeColor = (type: string) => {
    const colors: Record<string, "default" | "primary" | "secondary" | "success" | "warning" | "danger"> = {
      Single: 'primary',
      Phrase: 'success',
      Sentence: 'warning',
      Symbol: 'secondary',
      Link: 'secondary',
      Poem: 'secondary',
      Other: 'default'
    }
    return colors[type] || 'default'
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Finish':
        return 'success'
      case 'Draft':
        return 'warning'
      case 'Reject':
        return 'danger'
      default:
        return 'default'
    }
  }

  // Only show full page loading on first load
  if (isFirstLoad && isLoading) {
    return (
      <>
        <Navbar />
        <div className="min-h-screen flex items-center justify-center">
          <Spinner size="lg" label="加载中..." />
        </div>
      </>
    )
  }

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-background">
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-3xl font-bold">词库管理</h1>
            <div className="flex items-center gap-2">
              {(isSearching || isValidating) && <Spinner size="sm" />}
              <p className="text-default-500">共 {total} 条词条</p>
            </div>
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
              defaultSelectedKeys={""}
              onSelectionChange={(keys) => {
                const selected = Array.from(keys)[0] as string
                setTypeFilter(selected || '')
                setPage(1)
              }}
            >
              <SelectItem key="" >全部类型</SelectItem>
              <SelectItem key="Single">单字 (默认权重: 10)</SelectItem>
              <SelectItem key="Phrase">词组 (默认权重: 100)</SelectItem>
              <SelectItem key="Sentence">句子 (默认权重: 1000)</SelectItem>
              <SelectItem key="Symbol">符号 (默认权重: 10)</SelectItem>
              <SelectItem key="Link">连接 (默认权重: 10000)</SelectItem>
              <SelectItem key="Poem">诗词 (默认权重: 10000)</SelectItem>
              <SelectItem key="Other">其他 (默认权重: 10000)</SelectItem>
            </Select>
          </div>

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
                    <Chip color={getStatusColor(phrase.status)} variant="flat" size="sm">
                      {getStatusLabel(phrase.status)}
                    </Chip>
                  </TableCell>
                  <TableCell className="max-w-xs truncate">
                    {phrase.remark || '-'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {total > 20 && (
            <div className="flex justify-center mt-4">
              <Pagination
                total={Math.ceil(total / 20)}
                page={page}
                onChange={setPage}
              />
            </div>
          )}
        </main>
      </div>
    </>
  )
}
