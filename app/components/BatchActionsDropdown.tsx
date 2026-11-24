'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Button,
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem
} from '@/lib/heroui-compat'
import { MoreVertical, Trash2, Undo2 } from 'lucide-react'
import { useAuthStore } from '@/lib/store/auth'
import { useUIStore } from '@/lib/store/ui'
import { apiRequest } from '@/lib/hooks/useSWR'
import toast from 'react-hot-toast'

interface BatchActionsDropdownProps {
  batchId: string
  status: 'Draft' | 'Submitted' | 'Approved' | 'Rejected'
  creatorId: number
  itemReviewStarted?: boolean
  markRejectedReadVersion?: number
  onSuccess?: () => void | Promise<unknown>
  size?: 'sm' | 'md' | 'lg'
  iconSize?: number
}

export default function BatchActionsDropdown({
  batchId,
  status,
  creatorId,
  itemReviewStarted,
  markRejectedReadVersion,
  onSuccess,
  size = 'sm',
  iconSize = 16
}: BatchActionsDropdownProps) {
  const router = useRouter()
  const user = useAuthStore((state) => state.user)
  const { openConfirm } = useUIStore()
  const [isDeleting, setIsDeleting] = useState(false)
  const [isWithdrawing, setIsWithdrawing] = useState(false)
  const [isMarkingRead, setIsMarkingRead] = useState(false)

  const isOwner = user?.id === creatorId
  const canDelete = isOwner && !itemReviewStarted && (status === 'Draft' || status === 'Rejected')
  const canWithdraw = isOwner && !itemReviewStarted && status === 'Submitted'
  const canMarkRead = isOwner && status === 'Rejected' && markRejectedReadVersion !== undefined

  if (!canDelete && !canWithdraw && !canMarkRead) {
    return null
  }

  const handleMarkRead = async () => {
    setIsMarkingRead(true)
    try {
      await apiRequest(`/api/batches/${batchId}/rejection-read`, {
        method: 'POST',
        body: { expectedContentVersion: markRejectedReadVersion }
      })
      await onSuccess?.()
      toast.success('已标记为已读')
    } catch (error) {
      if (error instanceof Error && 'status' in error && error.status === 409) await onSuccess?.()
      toast.error(error instanceof Error ? error.message : '标记已读失败')
    } finally {
      setIsMarkingRead(false)
    }
  }

  const handleDelete = async () => {
    openConfirm('确定要删除这个批次吗？此操作不可恢复。', async () => {
      setIsDeleting(true)
      try {
        await apiRequest(`/api/batches/${batchId}`, {
          method: 'DELETE',
          withAuth: true
        })
        toast.success('批次已删除')
        if (onSuccess) {
          onSuccess()
        } else {
          router.push('/')
        }
      } catch (error) {
        console.error('Delete error:', error)
        const err = error as Error
        toast.error(err.message || '删除失败')
      } finally {
        setIsDeleting(false)
      }
    }, '删除批次', '删除')
  }

  const handleWithdraw = async () => {
    openConfirm('确定要撤销这个批次的提交吗？批次将变回草稿状态。', async () => {
      setIsWithdrawing(true)
      try {
        await apiRequest(`/api/batches/${batchId}/withdraw`, {
          method: 'POST',
          withAuth: true
        })
        if (onSuccess) {
          await onSuccess()
        } else {
          router.refresh()
        }
        toast.success('已撤销提交')
      } catch (error) {
        console.error('Withdraw error:', error)
        const err = error as Error
        toast.error(err.message || '撤销失败')
      } finally {
        setIsWithdrawing(false)
      }
    }, '撤销提交', '撤销')
  }

  return (
    <Dropdown>
      <DropdownTrigger>
        <Button
          aria-label="批次操作"
          isIconOnly
          size={size}
          variant="light"
          onClick={(e: React.MouseEvent<HTMLElement>) => {
            e.preventDefault()
            e.stopPropagation()
          }}
        >
          <MoreVertical size={iconSize} />
        </Button>
      </DropdownTrigger>
      <DropdownMenu
        aria-label="批次操作"
        onAction={(key) => {
          if (key === 'mark-read') {
            handleMarkRead()
          } else if (key === 'withdraw') {
            handleWithdraw()
          } else if (key === 'delete') {
            handleDelete()
          }
        }}
      >
        {canMarkRead ? (
          <DropdownItem key="mark-read" isDisabled={isMarkingRead}>
            标记为已读
          </DropdownItem>
        ) : null}
        {canWithdraw ? (
          <DropdownItem
            key="withdraw"
            startContent={<Undo2 size={16} />}
            isDisabled={isWithdrawing}
          >
            撤销提交
          </DropdownItem>
        ) : null}
        {canDelete ? (
          <DropdownItem
            key="delete"
            className="text-danger"
            color="danger"
            startContent={<Trash2 size={16} />}
            isDisabled={isDeleting}
          >
            删除批次
          </DropdownItem>
        ) : null}
      </DropdownMenu>
    </Dropdown>
  )
}
