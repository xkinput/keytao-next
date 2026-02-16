'use client'

import { useState, useEffect } from 'react'
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
  Link,
} from '@heroui/react'
import { CheckCircle2, AlertCircle } from 'lucide-react'

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
  const [hasStarted, setHasStarted] = useState(false)
  const [githubBranch, setGithubBranch] = useState<string | null>(null)

  const progress = totalCount > 0 ? Math.floor((processedCount / totalCount) * 100) : 0

  // Generate GitHub branch URL
  const githubOwner = 'xkinput'
  const githubRepo = 'KeyTao'
  const githubBranchUrl = githubBranch
    ? `https://github.com/${githubOwner}/${githubRepo}/tree/${githubBranch}`
    : null

  // Prepare sync task (or retry existing task)
  const prepare = async () => {
    try {
      setHasStarted(true)
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
      console.log('[Modal] Received summary:', result.summary?.slice(0, 200))
      setTotalCount(result.totalFiles)
      setStatus('processing')

      // Auto start processing - pass summary directly to avoid state update delay
      processNextBatch(result.taskId, result.files, 0, result.summary)
    } catch (err) {
      setError(err instanceof Error ? err.message : '准备同步失败')
      setStatus('error')
    }
  }

  // Process next batch
  const processNextBatch = async (
    tid: string = taskId,
    fileList: SyncFile[] = files,
    processed: number = processedCount,
    summaryText: string = summary
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
        await finalize(tid, summaryText)
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

      // Store branch info if returned
      if (result.branch && !githubBranch) {
        setGithubBranch(result.branch)
      }

      setProcessedCount(endIdx)

      // Check if all files are processed
      if (endIdx >= fileList.length) {
        // All files processed, finalize
        await finalize(tid, summaryText)
        return
      }

      // Continue automatically
      setTimeout(() => processNextBatch(tid, fileList, endIdx, summaryText), 500)
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交文件失败')
      setStatus('error')
    } finally {
      setIsProcessing(false)
    }
  }

  // Finalize and create PR
  const finalize = async (tid: string = taskId, summaryText: string = summary) => {
    try {
      setStatus('finalizing')
      setError(null)

      console.log('[Modal] Calling finalize with summary:', summaryText?.slice(0, 200))

      const response = await fetch('/api/admin/sync-to-github/finalize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          taskId: tid,
          summary: summaryText,
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
    // Reset all state
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
    setHasStarted(false)
    setGithubBranch(null)
    onClose()
  }

  const handleClose = handleModalClose

  // Use useEffect to trigger preparation when modal opens
  useEffect(() => {
    if (isOpen && !hasStarted) {
      prepare()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, retryTaskId]) // Trigger when modal opens or retry task changes

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

              {githubBranchUrl && (
                <Card>
                  <CardBody className="py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-default-500">分支:</span>
                      <Link
                        href={githubBranchUrl}
                        target="_blank"
                        isExternal
                        className="text-xs"
                      >
                        {githubBranch}
                      </Link>
                    </div>
                  </CardBody>
                </Card>
              )}
            </div>
          )}

          {status === 'finalizing' && (
            <div className="text-center py-8 space-y-4">
              <Progress
                isIndeterminate
                aria-label="创建 PR..."
                className="max-w-md mx-auto"
              />
              <div>
                <p className="text-sm text-default-600">正在创建 Pull Request...</p>
                {processedCount > 0 && (
                  <p className="text-xs text-default-500 mt-2">
                    已成功提交 {processedCount} 个文件
                  </p>
                )}
              </div>
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
                <div className="space-y-2">
                  <Link
                    href={prUrl}
                    target="_blank"
                    isExternal
                    showAnchorIcon
                    color="primary"
                  >
                    查看 Pull Request
                  </Link>
                  <p className="text-xs text-default-400 break-all">
                    {prUrl}
                  </p>
                </div>
              )}
              {githubBranchUrl && (
                <div className="pt-2 border-t border-default-200">
                  <Link
                    href={githubBranchUrl}
                    target="_blank"
                    isExternal
                    showAnchorIcon
                    className="text-xs text-default-500"
                  >
                    查看分支: {githubBranch}
                  </Link>
                </div>
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
