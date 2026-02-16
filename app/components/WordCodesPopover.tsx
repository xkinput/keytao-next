'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
  Chip,
  Spinner,
  Input,
  Button
} from '@heroui/react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import toast from 'react-hot-toast'
import { getPhraseTypeLabel, type PhraseType } from '@/lib/constants/phraseTypes'

interface Phrase {
  id: number
  word: string
  code: string
  weight: number
  type: PhraseType
  remark: string | null
  user: {
    id: number
    name: string
    nickname: string | null
  }
}

interface WordCodesPopoverProps {
  word: string | null
  children: React.ReactNode
}

export default function WordCodesPopover({
  word,
  children
}: WordCodesPopoverProps) {
  const [phrases, setPhrases] = useState<Phrase[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [searchWord, setSearchWord] = useState('')
  const [page, setPage] = useState(1)
  const [pagination, setPagination] = useState({
    total: 0,
    totalPages: 0,
    pageSize: 6
  })
  const lastWordRef = useRef<string | null>(null)

  const fetchPhrases = useCallback(async (wordToSearch: string, pageNum: number) => {
    if (!wordToSearch) return

    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/phrases/by-word?word=${encodeURIComponent(wordToSearch)}&page=${pageNum}`)
      if (!response.ok) {
        throw new Error('查询失败')
      }

      const data = await response.json()
      setPhrases(data.phrases || [])
      setPagination({
        total: data.pagination.total,
        totalPages: data.pagination.totalPages,
        pageSize: data.pagination.pageSize
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '查询失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isOpen && word) {
      setSearchWord(word)
      setPage(1)
      fetchPhrases(word, 1)
      lastWordRef.current = word
    }
  }, [isOpen, word, fetchPhrases])

  // Auto-search with debounce (skip if same as lastWordRef)
  useEffect(() => {
    if (!searchWord || searchWord === lastWordRef.current) return

    const timer = setTimeout(() => {
      setPage(1)
      fetchPhrases(searchWord, 1)
      lastWordRef.current = searchWord
    }, 500)

    return () => clearTimeout(timer)
  }, [searchWord, fetchPhrases])

  const handleSearch = () => {
    if (searchWord) {
      setPage(1)
      fetchPhrases(searchWord, 1)
    }
  }

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= pagination.totalPages) {
      setPage(newPage)
      fetchPhrases(searchWord, newPage)
    }
  }

  const handleCopy = async (text: string, type: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${type}已复制：${text}`)
    } catch {
      toast.error('复制失败')
    }
  }

  return (
    <Popover
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      placement="bottom"
      showArrow
    >
      <PopoverTrigger>
        {children}
      </PopoverTrigger>
      <PopoverContent className="w-125">
        <div className="px-1 py-2 w-full">
          <div className="mb-3">
            <Input
              size="sm"
              value={searchWord}
              onValueChange={setSearchWord}
              placeholder="输入词条查询"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSearch()
                }
              }}
            />
          </div>

          {loading && (
            <div className="flex justify-center py-4">
              <Spinner size="sm" />
            </div>
          )}

          {error && (
            <div className="text-danger text-center py-4 text-small">{error}</div>
          )}

          {!loading && !error && phrases.length === 0 && (
            <div className="text-default-500 text-center py-4 text-small">
              该词条暂无编码
            </div>
          )}

          {!loading && !error && phrases.length > 0 && (
            <div>
              <div className="flex justify-between items-center mb-2">
                <p className="text-tiny text-default-400">
                  共 {pagination.total} 个编码
                </p>
                {pagination.totalPages > 1 && (
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="flat"
                      isIconOnly
                      isDisabled={page === 1}
                      onPress={() => handlePageChange(page - 1)}
                    >
                      <ChevronLeft size={14} />
                    </Button>
                    <span className="text-tiny text-default-600">
                      {page} / {pagination.totalPages}
                    </span>
                    <Button
                      size="sm"
                      variant="flat"
                      isIconOnly
                      isDisabled={page === pagination.totalPages}
                      onPress={() => handlePageChange(page + 1)}
                    >
                      <ChevronRight size={14} />
                    </Button>
                  </div>
                )}
              </div>
              <Table
                aria-label="词条编码列表"
                removeWrapper
                className="max-h-100 overflow-auto"
              >
                <TableHeader>
                  <TableColumn>词条</TableColumn>
                  <TableColumn>编码</TableColumn>
                  <TableColumn>权重</TableColumn>
                  <TableColumn>类型</TableColumn>
                </TableHeader>
                <TableBody>
                  {phrases.map((phrase) => (
                    <TableRow key={phrase.id}>
                      <TableCell>
                        <div
                          onClick={() => handleCopy(phrase.word, '词条')}
                          className="cursor-pointer hover:bg-default-100 rounded px-1 -mx-1 py-0.5 -my-0.5 transition-colors"
                        >
                          <span className="font-medium text-small">{phrase.word}</span>
                          {phrase.remark && (
                            <p className="text-tiny text-default-400 mt-0.5">
                              {phrase.remark}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span
                          onClick={() => handleCopy(phrase.code, '编码')}
                          className="text-small text-default-600 font-mono cursor-pointer hover:bg-default-100 rounded px-1 -mx-1 py-0.5 -my-0.5 transition-colors inline-block"
                        >
                          {phrase.code}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="text-small text-default-600">{phrase.weight}</span>
                      </TableCell>
                      <TableCell>
                        <Chip size="sm" variant="flat" className="text-tiny">
                          {getPhraseTypeLabel(phrase.type)}
                        </Chip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
