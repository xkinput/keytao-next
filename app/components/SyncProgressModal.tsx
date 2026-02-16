'use client'

import { useState } from 'react'
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Progress,
  Card,
  CardBody,
  Chip,
  Link,
} from '@heroui/react'
import { CheckCircle2, AlertCircle, ExternalLink } from 'lucide-react'

interface SyncFile {
  name: string
  content: string
}

interface SyncProgressModalProps {
  isOpen: boolean
  onClose: () => void
  token: string
  onComplete: () => void
  retryTaskId?: string // Optional: if provided, retry this task instead of creating new
}

export function SyncProgressModal({
  isOpen,
  onClose,
  token,
  onComplete,
  retryTaskId,
}: SyncProgressModalProps) {
  const [status, setStatus] = useState<'preparing' | 'processing' | 'finalizing' | 'completed' | 'error'>('preparing')
  const [taskId, setTaskId] = useState<string>('')
  const [files, setFiles] = useState<SyncFile[]>([])
  const [summary, setSummary] = useState<string>('')
  const [processedCount, setProcessedCount] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [currentBatch, setCurrentBatch] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [prUrl, setPrUrl] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [autoMode, setAutoMode] = useState(true)

  const progress = totalCount > 0 ? Math.floor((processedCount / totalCount) * 100) : 0

  // Prepare sync task (or retry existing task)
  const prepare = async () => {
    try {
      setStatus('preparing')
      setError(null)

      // Use retry endpoint if retryTaskId is provided
      const url = retryTaskId
        ? `/api/admin/sync-to-github/retry/${retryTaskId}`
        : '/api/admin/sync-to-github/prepare'

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      const result = await response.json()

      if (!response.ok || !result.success) {
        throw new Error(result.error || '准备同步失败')
      }

      setTaskId(result.taskId)
      setFiles(result.files)
      setSummary(result.summary)
      setTotalCount(result.totalFiles)
      setStatus('processing')

      // Auto start if in auto mode
      if (autoMode) {
        processNextBatch(result.taskId, result.files, 0)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '准备同步失败')
      setStatus('error')
    }
  }

  // Process next batch
  const processNextBatch = async (
    tid: string = taskId,
    fileList: SyncFile[] = files,
    processed: number = processedCount
  ) => {
    if (isProcessing) return

    try {
      setIsProcessing(true)
      setError(null)

      const batchSize = 5
      const startIdx = processed
      const endIdx = Math.min(startIdx + batchSize, fileList.length)
      const batch = fileList.slice(startIdx, endIdx)

      if (batch.length === 0) {
        // All files processed, finalize
        await finalize(tid)
        return
      }

      setCurrentBatch(Math.floor(processed / batchSize) + 1)

      const response = await fetch('/api/admin/sync-to-github/commit-batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          taskId: tid,
          files: batch,
          processedCount: endIdx,
          totalCount: fileList.length,
        }),
      })

      const result = await response.json()

      if (!response.ok || !result.success) {
        throw new Error(result.error || '提交文件失败')
      }

      setProcessedCount(endIdx)

      // Continue if in auto mode and not finished
      if (autoMode && endIdx < fileList.length) {
        setTimeout(() => processNextBatch(tid, fileList, endIdx), 500)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交文件失败')
      setStatus('error')
    } finally {
      setIsProcessing(false)
    }
  }

  // Finalize and create PR
  const finalize = async (tid: string = taskId) => {
    try {
      setStatus('finalizing')
      setError(null)

      const response = await fetch('/api/admin/sync-to-github/finalize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          taskId: tid,
          summary,
        }),
      })

      const result = await response.json()

      if (!response.ok || !result.success) {
        throw new Error(result.error || '创建 PR 失败')
      }

      setPrUrl(result.prUrl)
      setStatus('completed')
      onComplete()
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建 PR 失败')
      setStatus('error')
    }
  }

  // Reset state when modal closes
  const handleModalClose = () => {
    if (status === 'processing' && processedCount < totalCount) {
      if (!confirm('同步尚未完成，确定要关闭吗？\n\n你可以稍后在任务列表中重试。')) {
        return
      }
    }
    // Reset state
    setStatus('preparing')
    setTaskId('')
    setFiles([])
    setSummary('')
    setProcessedCount(0)
    setTotalCount(0)
    setCurrentBatch(0)
    setError(null)
    setPrUrl(null)
    setIsProcessing(false)
    onClose()
  }

  const handleClose = handleModalClose

  const handleContinue = () => {
    processNextBatch()
  }

  // Auto start preparation when modal opens
  // Reset state when modal opens for a new/different task
  if (isOpen && status === 'preparing' && !taskId) {
    prepare()
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      size="2xl"
      isDismissable={status === 'completed' || status === 'error'}
      hideCloseButton={status === 'processing' && isProcessing}
    >
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1">
          {status === 'completed' ? '同步完成' : status === 'error' ? '同步失败' : '正在同步到 GitHub'}
        </ModalHeader>
        <ModalBody>
          {status === 'preparing' && (
            <div className="text-center py-8">
              <Progress
                isIndeterminate
                aria-label="准备中..."
                className="max-w-md mx-auto"
              />
              <p className="text-sm text-default-600 mt-4">正在准备同步任务...</p>
            </div>
          )}

          {status === 'processing' && (
            <div className="space-y-4">
              <Card>
                <CardBody>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium">处理进度</span>
                      <span className="text-sm text-default-600">
                        {processedCount} / {totalCount} 个文件
                      </span>
                    </div>
                    <Progress
                      value={progress}
                      className="max-w-full"
                      color="primary"
                      showValueLabel
                    />
                    {currentBatch > 0 && (
                      <p className="text-xs text-default-500">
                        第 {currentBatch} 批 (每批 5 个文件)
                      </p>
                    )}
                  </div>
                </CardBody>
              </Card>

              <div className="flex items-center gap-2">
                <Chip size="sm" color={autoMode ? 'primary' : 'default'}>
                  {autoMode ? '自动模式' : '手动模式'}
                </Chip>
                <Button
                  size="sm"
                  variant="flat"
                  onPress={() => setAutoMode(!autoMode)}
                >
                  切换到{autoMode ? '手动' : '自动'}模式
                </Button>
              </div>

              {!autoMode && processedCount < totalCount && (
                <Button
                  color="primary"
                  onPress={handleContinue}
                  isLoading={isProcessing}
                  fullWidth
                >
                  继续处理下一批 ({Math.min(5, totalCount - processedCount)} 个文件)
                </Button>
              )}
            </div>
          )}

          {status === 'finalizing' && (
            <div className="text-center py-8">
              <Progress
                isIndeterminate
                aria-label="创建 PR..."
                className="max-w-md mx-auto"
              />
              <p className="text-sm text-default-600 mt-4">正在创建 Pull Request...</p>
            </div>
          )}

          {status === 'completed' && (
            <div className="text-center py-8 space-y-4">
              <CheckCircle2 className="w-16 h-16 text-success mx-auto" />
              <div>
                <h3 className="text-lg font-semibold">同步完成！</h3>
                <p className="text-sm text-default-600 mt-2">
                  已成功提交 {totalCount} 个文件并创建 Pull Request
                </p>
              </div>
              {prUrl && (
                <Button
                  as={Link}
                  href={prUrl}
                  target="_blank"
                  color="primary"
                  endContent={<ExternalLink className="w-4 h-4" />}
                >
                  查看 Pull Request
                </Button>
              )}
            </div>
          )}

          {status === 'error' && (
            <div className="text-center py-8 space-y-4">
              <AlertCircle className="w-16 h-16 text-danger mx-auto" />
              <div>
                <h3 className="text-lg font-semibold text-danger">同步失败</h3>
                <p className="text-sm text-default-600 mt-2">{error}</p>
                {processedCount > 0 && (
                  <p className="text-xs text-default-500 mt-2">
                    已处理 {processedCount} / {totalCount} 个文件
                  </p>
                )}
              </div>
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          {status === 'completed' || status === 'error' ? (
            <Button color="primary" onPress={handleClose}>
              关闭
            </Button>
          ) : (
            <Button
              color="danger"
              variant="light"
              onPress={handleClose}
              isDisabled={isProcessing}
            >
              取消
            </Button>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
