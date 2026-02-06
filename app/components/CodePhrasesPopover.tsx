'use client'

import { useState, useEffect, useCallback } from 'react'
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
  Spinner
} from '@heroui/react'
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

interface CodePhrasesPopoverProps {
  code: string | null
  children: React.ReactNode
}

export default function CodePhrasesPopover({
  code,
  children
}: CodePhrasesPopoverProps) {
  const [phrases, setPhrases] = useState<Phrase[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isOpen, setIsOpen] = useState(false)

  const fetchPhrases = useCallback(async () => {
    if (!code) return

    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/phrases/by-code?code=${encodeURIComponent(code)}`)
      if (!response.ok) {
        throw new Error('查询失败')
      }

      const data = await response.json()
      setPhrases(data.phrases || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : '查询失败')
    } finally {
      setLoading(false)
    }
  }, [code])

  useEffect(() => {
    if (isOpen && code) {
      fetchPhrases()
    }
  }, [isOpen, code, fetchPhrases])

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
              该编码暂无词条
            </div>
          )}

          {!loading && !error && phrases.length > 0 && (
            <div>
              <p className="text-tiny text-default-400 mb-2">
                共 {phrases.length} 个词条
              </p>
              <Table
                aria-label="编码词条列表"
                removeWrapper
                className="max-h-100 overflow-auto"
              >
                <TableHeader>
                  <TableColumn>词条</TableColumn>
                  <TableColumn>权重</TableColumn>
                  <TableColumn>类型</TableColumn>
                </TableHeader>
                <TableBody>
                  {phrases.map((phrase) => (
                    <TableRow key={phrase.id}>
                      <TableCell>
                        <div>
                          <span className="font-medium text-small">{phrase.word}</span>
                          {phrase.remark && (
                            <p className="text-tiny text-default-400 mt-0.5">
                              {phrase.remark}
                            </p>
                          )}
                        </div>
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
