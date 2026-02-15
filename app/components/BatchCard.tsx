'use client'

import { memo } from 'react'
import Link from 'next/link'
import {
  Card,
  CardBody,
  CardHeader,
  Chip,
  Divider
} from '@heroui/react'
import { User, FileEdit, AlertTriangle } from 'lucide-react'
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
      case 'Create': return '+'
      case 'Change': return '~'
      case 'Delete': return '-'
      default: return '?'
    }
  }

  const getActionStyle = (action: string) => {
    switch (action) {
      case 'Create': return 'text-success font-bold'
      case 'Change': return 'text-warning font-bold'
      case 'Delete': return 'text-danger font-bold'
      default: return 'text-default-500'
    }
  }

  const hasConflicts = batch.pullRequests.some(pr => pr.hasConflict) ||
    (batch._count.pullRequests > 0 && batch.pullRequests.some(pr => pr.conflictInfo?.hasConflict))

  return (
    <Card className="hover:scale-[1.01] transition-transform duration-200">
      <CardHeader className="flex flex-col md:flex-row md:justify-between md:items-center pb-3 gap-2">
        <Link href={`/batch/${batch.id}`} className="flex items-center gap-2 overflow-hidden flex-1 min-w-0">
          <h3 className="text-lg font-semibold truncate" title={batch.description || '未命名批次'}>
            {batch.description || '未命名批次'}
          </h3>
          <Chip
            color={STATUS_COLOR_MAP[batch.status] || 'default'}
            size="sm"
            variant="flat"
            className="shrink-0"
          >
            {BATCH_STATUS_MAP[batch.status] || batch.status}
          </Chip>
          {hasConflicts && (
            <span title="存在冲突" className="shrink-0">
              <AlertTriangle size={16} className="text-warning" />
            </span>
          )}
        </Link>

        <div className="flex items-center gap-2 text-xs text-default-500 shrink-0 w-full md:w-auto justify-between md:justify-end">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1" title="修改数量">
              <FileEdit size={14} />
              <span>{batch._count.pullRequests}</span>
            </div>
            <div className="flex items-center gap-1" title="创建者">
              <User size={14} />
              <span className="max-w-20 truncate">{batch.creator.nickname || batch.creator.name}</span>
            </div>
            <span title="创建时间">{new Date(batch.createAt).toLocaleDateString()}</span>
          </div>

          <BatchActionsDropdown
            batchId={batch.id}
            status={batch.status}
            creatorId={batch.creator.id}
            onSuccess={refresh}
          />
        </div>
      </CardHeader>

      <Divider />

      <Link href={`/batch/${batch.id}`}>
        <CardBody className="py-3 cursor-pointer">
          {batch.sourceIssue && (
            <div className="mb-3 text-xs">
              <span className="text-default-500 mr-1">关联:</span>
              <span className="text-primary truncate max-w-50">
                #{batch.sourceIssue.id} {batch.sourceIssue.title}
              </span>
            </div>
          )}

          {batch.pullRequests.length > 0 ? (
            <div className="space-y-2 mb-3">
              {batch.pullRequests.slice(0, 3).map((pr) => (
                <div key={pr.id} className="flex items-center text-sm gap-2 font-mono">
                  <span className={`w-4 text-center ${getActionStyle(pr.action)}`}>
                    {getActionIcon(pr.action)}
                  </span>
                  <span className="text-default-600 min-w-15 max-w-20 truncate" title={pr.code || ''}>{pr.code}</span>
                  <div className="flex-1 min-w-0 truncate">
                    {pr.action === 'Delete' ? (
                      <span className="text-danger line-through opacity-70">{pr.word}</span>
                    ) : pr.action === 'Change' ? (
                      <span className="flex items-center gap-1">
                        <span className="opacity-60">{pr.oldWord}</span>
                        <span className="text-xs text-default-400">→</span>
                        <span className="text-warning-600 dark:text-warning">{pr.word}</span>
                      </span>
                    ) : (
                      <span className="text-success-600 dark:text-success">{pr.word}</span>
                    )}
                  </div>
                  {pr.hasConflict && (
                    <span className="text-xs text-warning" title="存在冲突">⚠️</span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-default-400 py-2 pl-6 italic">
              暂无修改内容
            </div>
          )}
        </CardBody>
      </Link>
    </Card>
  )
}

export default memo(BatchCard)

