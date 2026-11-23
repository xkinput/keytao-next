'use client'

import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Button } from '@/lib/heroui-compat'
import { apiRequest, useAPI } from '@/lib/hooks/useSWR'
import type { BatchItemVoteChoice, BatchItemVoteSummary } from '@/app/api/batches/[id]/votes/route'

export type { BatchItemVoteSummary }

export function useBatchItemVotes(batchId: string, enabled: boolean) {
  const { data, error, isLoading, mutate } = useAPI<{ votes: BatchItemVoteSummary[] }>(
    enabled ? `/api/batches/${batchId}/votes` : null,
    { keepPreviousData: false },
  )
  const byItem = useMemo(() => new Map(data?.votes.map(vote => [vote.itemId, vote])), [data])

  function update(next: BatchItemVoteSummary) {
    return mutate(current => current && {
      votes: current.votes.map(vote => vote.itemId === next.itemId ? next : vote),
    }, { revalidate: true, throwOnError: false })
  }

  return { byItem, update, refresh: mutate, error, isLoading }
}

interface BatchItemVoteProps {
  batchId: string
  itemId: number
  status?: string
  vote?: BatchItemVoteSummary
  onChange: (next: BatchItemVoteSummary) => void | Promise<unknown>
}

export default function BatchItemVote({ batchId, itemId, status, vote, onChange }: BatchItemVoteProps) {
  const [saving, setSaving] = useState(false)

  if (!vote) return null

  async function save(choice: Exclude<BatchItemVoteChoice, null>) {
    if (saving || !vote?.canVote || (status !== undefined && status !== 'Pending')) return
    setSaving(true)
    try {
      const result = await apiRequest<{ vote: BatchItemVoteSummary }>(`/api/batches/${batchId}/votes`, {
        method: 'POST',
        body: { itemId, vote: vote.vote === choice ? null : choice },
      })
      await onChange(result.vote)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '投票失败，请重试')
    } finally {
      setSaving(false)
    }
  }

  if (!vote.canVote || (status !== undefined && status !== 'Pending')) {
    return <span className="text-xs text-default-500">赞成 {vote.likes} · 反对 {vote.dislikes}</span>
  }

  return (
    <div role="group" aria-label="社区投票" aria-busy={saving} className="flex flex-wrap items-center gap-1">
      <Button
        type="button"
        size="sm"
        variant={vote.vote === 'like' ? 'flat' : 'light'}
        color={vote.vote === 'like' ? 'primary' : 'default'}
        aria-pressed={vote.vote === 'like'}
        isDisabled={saving}
        onPress={() => void save('like')}
      >
        赞成 {vote.likes}
      </Button>
      <Button
        type="button"
        size="sm"
        variant={vote.vote === 'dislike' ? 'flat' : 'light'}
        color={vote.vote === 'dislike' ? 'primary' : 'default'}
        aria-pressed={vote.vote === 'dislike'}
        isDisabled={saving}
        onPress={() => void save('dislike')}
      >
        反对 {vote.dislikes}
      </Button>
    </div>
  )
}
