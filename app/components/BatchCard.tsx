'use client'

import { memo } from 'react'
import Link from 'next/link'
import {
  Card,
  CardBody,
  CardHeader,
  Chip,
  Divider
} from '@/lib/heroui-compat'
import { AlertTriangle, ArrowRight, CalendarClock, CirclePlus, FileEdit, PencilLine, Trash2, User } from 'lucide-react'
import BatchActionsDropdown from './BatchActionsDropdown'
import { BATCH_STATUS_MAP, STATUS_COLOR_MAP } from '@/lib/constants/status'

interface BatchCardProps {
  batch: {
    id: string
    description: string
    status: 'Draft' | 'Submitted' | 'Approved' | 'Rejected' | 'Published'
    createAt: string
    creator: {
      id: number
      name: string
      nickname: string | null
    }
    sourceIssue?: {
      id: number
      title: string
    }
    pullRequests: Array<{
      id: number
      status: string
      hasConflict: boolean
      action: 'Create' | 'Change' | 'Delete'
      code: string | null
      word: string | null
      oldWord?: string | null
      conflictInfo?: {
        hasConflict: boolean
        impact?: string
        suggestions?: Array<{
          action: string
          word?: string
          reason: string
        }>
      }
    }>
    _count: {
      pullRequests: number
    }
  }
  refresh: () => void
}

function BatchCard({ batch, refresh }: BatchCardProps) {

  const getActionIcon = (action: string) => {
    switch (action) {
      case 'Create': return <CirclePlus className="h-3.5 w-3.5" />
      case 'Change': return <PencilLine className="h-3.5 w-3.5" />
      case 'Delete': return <Trash2 className="h-3.5 w-3.5" />
      default: return <FileEdit className="h-3.5 w-3.5" />
    }
  }

  const getActionStyle = (action: string) => {
    switch (action) {
      case 'Create': return 'bg-success-50 text-success'
      case 'Change': return 'bg-warning-50 text-warning'
      case 'Delete': return 'bg-danger-50 text-danger'
      default: return 'text-default-500'
    }
  }

  const hasConflicts = batch.pullRequests.some(pr => pr.hasConflict) ||
    (batch._count.pullRequests > 0 && batch.pullRequests.some(pr => pr.conflictInfo?.hasConflict))

  return (
    <Card className="group interactive-lift overflow-hidden hover:border-primary/35 hover:shadow-[0_18px_42px_hsl(var(--shadow-color)/0.10)]">
      <CardHeader className="flex flex-col gap-3 p-4 md:flex-row md:items-start md:justify-between">
        <Link href={`/batch/${batch.id}`} className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-base font-semibold tracking-tight text-foreground group-hover:text-primary" title={batch.description || '未命名批次'}>
              {batch.description || '未命名批次'}
            </h3>
            {hasConflicts && (
              <span title="存在冲突" className="shrink-0 rounded-md bg-warning-50 p-1 text-warning">
                <AlertTriangle size={14} />
              </span>
            )}
          </div>
          {batch.sourceIssue && (
            <p className="mt-1 truncate text-xs text-default-500">
              关联 #{batch.sourceIssue.id} {batch.sourceIssue.title}
            </p>
          )}
        </Link>

        <div className="flex w-full shrink-0 items-center justify-between gap-2 md:w-auto md:justify-end">
          <div className="flex flex-wrap items-center gap-2 text-xs text-default-500">
            <Chip
              color={STATUS_COLOR_MAP[batch.status] || 'default'}
              size="sm"
              variant="flat"
              className="shrink-0"
            >
              {BATCH_STATUS_MAP[batch.status] || batch.status}
            </Chip>
            <div className="flex items-center gap-1 rounded-md bg-content2 px-2 py-1" title="修改数量">
              <FileEdit size={14} />
              <span>{batch._count.pullRequests}</span>
            </div>
            <div className="flex items-center gap-1 rounded-md bg-content2 px-2 py-1" title="创建者">
              <User size={14} />
              <span className="max-w-20 truncate">{batch.creator.nickname || batch.creator.name}</span>
            </div>
            <div className="flex items-center gap-1 rounded-md bg-content2 px-2 py-1" title="创建时间">
              <CalendarClock size={14} />
              <span>{new Date(batch.createAt).toLocaleDateString()}</span>
            </div>
          </div>

          <BatchActionsDropdown
            batchId={batch.id}
            status={batch.status}
            creatorId={batch.creator.id}
            onSuccess={refresh}
          />
        </div>
      </CardHeader>

      <Divider className="opacity-70" />

      <Link href={`/batch/${batch.id}`}>
        <CardBody className="cursor-pointer px-4 py-3">
          {batch.pullRequests.length > 0 ? (
            <div className="space-y-2 mb-3">
              {batch.pullRequests.slice(0, 3).map((pr) => (
                <div key={pr.id} className="flex items-center gap-2 rounded-md bg-content2/65 px-2.5 py-2 text-sm">
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${getActionStyle(pr.action)}`}>
                    {getActionIcon(pr.action)}
                  </span>
                  <span className="min-w-15 max-w-20 truncate font-mono text-default-600" title={pr.code || ''}>{pr.code}</span>
                  <div className="flex-1 min-w-0 truncate">
                    {pr.action === 'Delete' ? (
                      <span className="text-danger line-through opacity-70">{pr.word}</span>
                    ) : pr.action === 'Change' ? (
                      <span className="flex items-center gap-1">
                        <span className="opacity-60">{pr.oldWord}</span>
                        <ArrowRight className="h-3 w-3 text-default-400" />
                        <span className="text-warning-600 dark:text-warning">{pr.word}</span>
                      </span>
                    ) : (
                      <span className="text-success-600 dark:text-success">{pr.word}</span>
                    )}
                  </div>
                  {pr.hasConflict && (
                    <span title="存在冲突">
                      <AlertTriangle className="w-3 h-3 text-warning" />
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-default-200 bg-content2/50 px-3 py-3 text-sm text-default-500">
              暂无修改内容
            </div>
          )}
        </CardBody>
      </Link>
    </Card>
  )
}

export default memo(BatchCard)
