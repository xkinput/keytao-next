'use client'

import { Suspense, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button, Chip, Input, Skeleton } from '@/lib/heroui-compat'
import { History, Search } from 'lucide-react'
import { useAPI } from '@/lib/hooks/useSWR'
import { getPhraseTypeLabel, type PhraseType } from '@/lib/constants/phraseTypes'
import { PR_STATUS_MAP, STATUS_COLOR_MAP } from '@/lib/constants/status'

interface HistoryUser {
  id: number
  name: string | null
  nickname: string | null
}

interface HistoryEntry {
  id: number
  action: 'Create' | 'Change' | 'Delete'
  word: string | null
  oldWord: string | null
  code: string | null
  type: PhraseType | null
  weight: number | null
  remark: string | null
  status: 'Pending' | 'Approved' | 'Rejected'
  createAt: string
  author: HistoryUser
  batch: {
    id: string
    description: string | null
    status: 'Submitted' | 'Approved' | 'Rejected'
    createAt: string
    reviewedAt: string | null
    reviewNote: string | null
    creator: HistoryUser
    reviewer: HistoryUser | null
    published: boolean
    syncedAt: string | null
  }
}

interface HistoryResponse {
  entries: HistoryEntry[]
  current: Array<{
    id: number
    word: string
    code: string
    type: PhraseType
    weight: number
    remark: string | null
    updateAt: string
  }>
}

const ACTIONS = {
  Create: { label: '新增', color: 'success' },
  Change: { label: '修改', color: 'warning' },
  Delete: { label: '删除', color: 'danger' },
} as const

function formatDate(value: string) {
  const date = new Date(value)
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function HistorySkeleton() {
  return (
    <div className="space-y-6 py-4" role="status" aria-label="加载中">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="space-y-3">
          <Skeleton className="h-4 w-36 rounded" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
      ))}
    </div>
  )
}

function HistoryResults({ word, code }: { word: string; code: string }) {
  const router = useRouter()
  const [wordInput, setWordInput] = useState(word)
  const [codeInput, setCodeInput] = useState(code)
  const params = new URLSearchParams()
  if (word) params.set('word', word)
  if (code) params.set('code', code)

  const { data, error, isLoading } = useAPI<HistoryResponse>(
    word || code ? `/api/phrases/history?${params.toString()}` : null,
    { withAuth: false, keepPreviousData: false }
  )

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const query = new URLSearchParams()
    if (wordInput.trim()) query.set('word', wordInput.trim())
    if (codeInput.trim()) query.set('code', codeInput.trim())
    router.push(query.size ? `/phrases/history?${query.toString()}` : '/phrases/history')
  }

  return (
    <>
      <form onSubmit={handleSearch} className="workbench-toolbar mb-6 flex flex-col gap-3 rounded-xl p-3 sm:flex-row sm:items-end">
        <Input label="词" value={wordInput} onValueChange={setWordInput} maxLength={50} className="w-full sm:max-w-xs" />
        <Input label="编码" value={codeInput} onValueChange={setCodeInput} maxLength={50} className="w-full sm:max-w-xs" />
        <Button type="submit" color="primary" startContent={<Search className="h-4 w-4" />}>
          搜索
        </Button>
      </form>

      {isLoading ? <HistorySkeleton /> : error ? (
        <p role="alert" className="py-8 text-center text-danger">{error.message || '获取修改记录失败'}</p>
      ) : (
        <>
          {!!data?.current.length && (
            <section className="mb-7 rounded-xl border border-default-200 p-4">
              <h2 className="mb-3 text-sm font-semibold">当前词库</h2>
              <ul className="space-y-2">
                {data.current.map((phrase) => (
                  <li key={phrase.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    <span className="font-medium">{phrase.word}</span>
                    <code className="text-default-600">{phrase.code}</code>
                    <span className="text-default-500">{getPhraseTypeLabel(phrase.type)}</span>
                    <span className="text-default-500">权重：{phrase.weight}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data?.entries.length ? (
            <ol className="ml-2 border-l border-default-200">
              {data.entries.map((entry) => {
                const date = entry.batch.reviewedAt ?? entry.createAt
                const action = ACTIONS[entry.action]
                return (
                  <li key={entry.id} className="relative pb-7 pl-6 last:pb-0">
                    <span className="absolute -left-1.5 top-1.5 h-3 w-3 rounded-full border-2 border-background bg-default-400" />
                    <time dateTime={date} className="text-xs text-default-500">{formatDate(date)}</time>
                    <article className="mt-2 space-y-3 rounded-xl border border-default-200 bg-content1 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Chip size="sm" variant="flat" color={action.color}>{action.label}</Chip>
                        <span className="break-all font-semibold">
                          {entry.action === 'Change' ? `${entry.oldWord ?? '—'} → ${entry.word ?? '—'}` : entry.word}
                        </span>
                        <code className="text-sm text-default-600">{entry.code}</code>
                        {entry.weight !== null && <span className="text-sm text-default-500">权重：{entry.weight}</span>}
                      </div>
                      {entry.remark && <p className="whitespace-pre-wrap break-words text-sm text-default-600">{entry.remark}</p>}
                      <div className="flex flex-wrap items-center gap-2">
                        <Chip size="sm" variant="flat" color={STATUS_COLOR_MAP[entry.status]}>{PR_STATUS_MAP[entry.status]}</Chip>
                        {entry.batch.published && (
                          <>
                            <Chip size="sm" variant="flat" color={STATUS_COLOR_MAP.Published}>已发布</Chip>
                            {entry.batch.syncedAt && (
                              <time dateTime={entry.batch.syncedAt} className="text-xs text-default-500">{formatDate(entry.batch.syncedAt)}</time>
                            )}
                          </>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-default-500">
                        <Link href={`/batch/${entry.batch.id}`} className="text-primary hover:underline">
                          {entry.batch.description || '未命名批次'}
                        </Link>
                        <span>作者：{entry.author.nickname || entry.author.name || '—'}</span>
                        <span>审核人：{entry.batch.reviewer?.nickname || entry.batch.reviewer?.name || '—'}</span>
                      </div>
                      {entry.batch.reviewNote && <p className="whitespace-pre-wrap break-words text-sm text-danger">{entry.batch.reviewNote}</p>}
                    </article>
                  </li>
                )
              })}
            </ol>
          ) : (
            <div className="flex flex-col items-center gap-3 py-16 text-default-500">
              <History className="h-8 w-8 text-default-400" />
              <p>没有找到修改记录</p>
            </div>
          )}
        </>
      )}
    </>
  )
}

function HistoryContent() {
  const searchParams = useSearchParams()
  const word = (searchParams.get('word') || '').trim()
  const code = (searchParams.get('code') || '').trim()
  return <HistoryResults key={JSON.stringify([word, code])} word={word} code={code} />
}

export default function PhraseHistoryPage() {
  return (
    <div className="min-h-screen">
      <main className="app-container py-8 md:py-10">
        <div className="mb-7" data-motion="fade-up">
          <p className="page-kicker">公开词库</p>
          <h1 className="page-title">词条修改历史</h1>
        </div>
        <Suspense fallback={<HistorySkeleton />}>
          <HistoryContent />
        </Suspense>
      </main>
    </div>
  )
}
