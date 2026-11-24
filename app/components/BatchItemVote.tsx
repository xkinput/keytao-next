'use client'

import { useId, useMemo, useState } from 'react'
import { ThumbsDown, ThumbsUp } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button } from '@/lib/heroui-compat'
import { apiRequest, useAPI } from '@/lib/hooks/useSWR'
import { useAuthStore } from '@/lib/store/auth'
import type { BatchItemVoteChoice, BatchItemVoteSummary } from '@/app/api/batches/[id]/votes/route'

export type { BatchItemVoteSummary }

export function useBatchItemVotes(batchId: string, contentVersion?: number) {
  const { data, error, isLoading, mutate } = useAPI<{ contentVersion: number; votes: BatchItemVoteSummary[] }>(
    contentVersion === undefined ? null : `/api/batches/${batchId}/votes?version=${contentVersion}`,
    { keepPreviousData: false },
  )
  const currentVotes = data?.contentVersion === contentVersion ? data?.votes : undefined
  const byItem = useMemo(() => new Map(currentVotes?.map(vote => [vote.itemId, vote])), [currentVotes])

  function update(next: BatchItemVoteSummary) {
    return mutate(current => current && current.contentVersion === contentVersion ? {
      ...current,
      votes: current.votes.map(vote => vote.itemId === next.itemId ? next : vote),
    } : current, { revalidate: true, throwOnError: false })
  }

  return { byItem, update, refresh: mutate, error, isLoading }
}

interface BatchItemVoteProps {
  batchId: string
  itemId: number
  viewerId?: number
  label: string
  isOpen: boolean
  contentVersion: number
  vote: BatchItemVoteSummary
  onChange: (next: BatchItemVoteSummary) => void | Promise<unknown>
  onStale: () => Promise<unknown>
}

export default function BatchItemVote({
  batchId, itemId, viewerId, label, isOpen, contentVersion, vote, onChange, onStale,
}: BatchItemVoteProps) {
  const descriptionId = useId()
  const [saving, setSaving] = useState(false)

  async function save(choice: Exclude<BatchItemVoteChoice, null>) {
    if (!viewerId || useAuthStore.getState().user?.id !== viewerId || saving || !vote.canVote || !isOpen) return
    setSaving(true)
    try {
      const result = await apiRequest<{ vote: BatchItemVoteSummary }>(`/api/batches/${batchId}/votes`, {
        method: 'POST',
        body: { itemId, vote: vote.vote === choice ? null : choice, expectedContentVersion: contentVersion },
      })
      if (useAuthStore.getState().user?.id === viewerId) await onChange(result.vote)
    } catch (error) {
      if (useAuthStore.getState().user?.id !== viewerId) return
      toast.error(error instanceof Error ? error.message : '投票失败，请重试')
      if (error instanceof Error && 'status' in error && error.status === 409) await onStale()
    } finally {
      setSaving(false)
    }
  }

  if (!viewerId || !vote.canVote || !isOpen) {
    return (
      <span className="inline-flex items-center gap-2 whitespace-nowrap text-xs">
        <span className="inline-flex items-center gap-1">
          <ThumbsUp aria-hidden="true" className="size-3.5" />
          <span className="sr-only">赞同 </span>{vote.likes}
        </span>
        <span className="inline-flex items-center gap-1">
          <ThumbsDown aria-hidden="true" className="size-3.5" />
          <span className="sr-only">反对 </span>{vote.dislikes}
        </span>
      </span>
    )
  }

  return (
    <span role="group" aria-label="词条投票" aria-busy={saving} className="inline-flex items-center gap-1">
      {([
        ['like', '赞同', ThumbsUp, vote.likes],
        ['dislike', '反对', ThumbsDown, vote.dislikes],
      ] as const).map(([choice, action, Icon, count]) => {
        const selected = vote.vote === choice
        return (
          <Button
            key={choice}
            type="button"
            size="sm"
            variant={selected ? 'flat' : 'light'}
            color={selected ? 'primary' : 'default'}
            className={`min-w-8 px-1.5 text-xs tabular-nums aria-disabled:opacity-60 ${selected ? '' : 'text-inherit'}`}
            aria-label={`${action}「${label}」`}
            aria-describedby={`${descriptionId}-${choice}`}
            aria-pressed={selected}
            aria-disabled={saving || undefined}
            title={action}
            onPress={() => void save(choice)}
          >
            <Icon aria-hidden="true" className="size-3.5" />
            <span id={`${descriptionId}-${choice}`}>{count}<span className="sr-only"> 票</span></span>
          </Button>
        )
      })}
    </span>
  )
}
