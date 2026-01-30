'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Input,
  Textarea
} from '@heroui/react'
import { useAuthStore } from '@/lib/store/auth'
import { apiRequest } from '@/lib/hooks/useSWR'

interface CreateIssueModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

export default function CreateIssueModal({
  isOpen,
  onClose,
  onSuccess
}: CreateIssueModalProps) {
  const router = useRouter()
  const { isAuthenticated } = useAuthStore()
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleCreateIssue = async () => {
    if (!isAuthenticated()) {
      alert('请先登录')
      router.push('/login')
      return
    }

    if (!title || !content) return

    setSubmitting(true)
    try {
      await apiRequest('/api/issues', {
        method: 'POST',
        body: { title, content }
      })

      setTitle('')
      setContent('')
      onClose()
      onSuccess()
    } catch {
      alert('创建讨论失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleClose = () => {
    setTitle('')
    setContent('')
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} size="2xl">
      <ModalContent>
        <ModalHeader>新建讨论</ModalHeader>
        <ModalBody>
          <Input
            label="标题"
            placeholder="请输入讨论标题"
            value={title}
            onValueChange={setTitle}
            isRequired
          />
          <Textarea
            label="内容"
            placeholder="请输入讨论内容"
            value={content}
            onValueChange={setContent}
            isRequired
            minRows={6}
          />
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={handleClose}>
            取消
          </Button>
          <Button
            color="primary"
            onPress={handleCreateIssue}
            isLoading={submitting}
            isDisabled={!title || !content}
          >
            创建
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
