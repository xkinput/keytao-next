'use client'

import { useState, useEffect } from 'react'
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Input,
  Select,
  SelectItem,
  Textarea,
  Card,
  CardBody,
  CardHeader,
  Chip
} from '@heroui/react'
import { apiRequest } from '@/lib/hooks/useSWR'

interface CreatePRModalProps {
  isOpen: boolean
  onClose: () => void
  batchId?: string
  editPR?: {
    id: number
    word: string
    oldWord?: string
    code: string
    action: 'Create' | 'Change' | 'Delete'
    type?: string
    weight?: number
    remark?: string
  }
  onSuccess: () => void
}

interface ConflictInfo {
  hasConflict: boolean
  code: string
  currentPhrase?: {
    word: string
    code: string
    weight: number
  }
  impact?: string
  suggestions: Array<{
    action: string
    word: string
    fromCode?: string
    toCode?: string
    reason: string
  }>
}

interface PRItem {
  id: string
  action: 'Create' | 'Change' | 'Delete'
  word: string
  oldWord: string
  code: string
  type: string
  weight: string
  remark: string
  conflict: ConflictInfo | null
  hasChecked: boolean
  checking: boolean
}

export default function CreatePRModal({
  isOpen,
  onClose,
  batchId,
  editPR,
  onSuccess
}: CreatePRModalProps) {
  const isEditMode = !!editPR
  const [prItems, setPRItems] = useState<PRItem[]>([
    {
      id: '1',
      action: 'Create',
      word: '',
      oldWord: '',
      code: '',
      type: 'Phrase',
      weight: '',
      remark: '',
      conflict: null,
      hasChecked: false,
      checking: false
    }
  ])
  const [submitting, setSubmitting] = useState(false)
  const [checkingAll, setCheckingAll] = useState(false)

  // Reset when modal opens/closes or editPR changes
  useEffect(() => {
    if (isOpen) {
      if (editPR) {
        setPRItems([{
          id: '1',
          action: editPR.action,
          word: editPR.word,
          oldWord: editPR.oldWord || '',
          code: editPR.code,
          type: editPR.type || 'Phrase',
          weight: editPR.weight?.toString() || '',
          remark: editPR.remark || '',
          conflict: null,
          hasChecked: false,
          checking: false
        }])
      } else {
        setPRItems([{
          id: '1',
          action: 'Create',
          word: '',
          oldWord: '',
          code: '',
          type: 'Phrase',
          weight: '',
          remark: '',
          conflict: null,
          hasChecked: false,
          checking: false
        }])
      }
    }
  }, [editPR, isOpen])

  const updatePRItem = (id: string, updates: Partial<PRItem>) => {
    setPRItems(items => items.map(item => {
      if (item.id === id) {
        const newItem = { ...item, ...updates }
        // Reset check state if any data changed (except checking/hasChecked/conflict)
        if ('word' in updates || 'code' in updates || 'oldWord' in updates || 'action' in updates || 'weight' in updates) {
          newItem.hasChecked = false
          newItem.conflict = null
        }
        return newItem
      }
      return item
    }))
  }

  const addPRItem = () => {
    const newId = (Math.max(...prItems.map(item => parseInt(item.id))) + 1).toString()
    setPRItems([...prItems, {
      id: newId,
      action: 'Create',
      word: '',
      oldWord: '',
      code: '',
      type: 'Phrase',
      weight: '',
      remark: '',
      conflict: null,
      hasChecked: false,
      checking: false
    }])
  }

  const removePRItem = (id: string) => {
    if (prItems.length > 1) {
      setPRItems(items => items.filter(item => item.id !== id))
    }
  }

  const handleCheckAllConflicts = async () => {
    // Validate all items first
    for (const item of prItems) {
      if (!item.word || !item.code) {
        alert(`请填写完整的词和编码（修改 #${item.id}）`)
        return
      }
      if (item.action === 'Change' && !item.oldWord) {
        alert(`修改操作需要填写旧词（修改 #${item.id}）`)
        return
      }
    }

    setCheckingAll(true)

    try {
      const result = await apiRequest('/api/pull-requests/check-conflicts-batch', {
        method: 'POST',
        body: {
          items: prItems.map(item => ({
            id: item.id,
            action: item.action,
            word: item.word,
            oldWord: item.action === 'Change' ? item.oldWord : undefined,
            code: item.code,
            weight: item.weight ? parseInt(item.weight) : undefined
          }))
        }
      }) as { results: Array<{ id: string; conflict: ConflictInfo }> }

      // Update all items with conflict results
      setPRItems(items => items.map(item => {
        const itemResult = result.results.find(r => r.id === item.id)
        if (itemResult) {
          return {
            ...item,
            conflict: itemResult.conflict,
            hasChecked: true,
            checking: false
          }
        }
        return item
      }))
    } catch (err) {
      const error = err as Error
      alert(error.message || '检测失败')
    } finally {
      setCheckingAll(false)
    }
  }

  const handleSubmit = async () => {
    // Validate all items
    for (const item of prItems) {
      if (!item.word || !item.code) {
        alert(`请填写完整的词和编码（项目 #${item.id}）`)
        return
      }
      if (item.action === 'Change' && !item.oldWord) {
        alert(`修改操作需要填写旧词（项目 #${item.id}）`)
        return
      }
      if (!item.hasChecked) {
        alert(`请先检测冲突（项目 #${item.id}）`)
        return
      }
      if (item.conflict?.hasConflict) {
        alert(`存在冲突，请解决后再提交（项目 #${item.id}）`)
        return
      }
    }

    setSubmitting(true)
    try {
      if (isEditMode && editPR) {
        // Update existing PR
        const item = prItems[0]
        await apiRequest(`/api/pull-requests/${editPR.id}`, {
          method: 'PATCH',
          body: {
            action: item.action,
            word: item.word,
            oldWord: item.action === 'Change' ? item.oldWord : undefined,
            code: item.code,
            type: item.action !== 'Delete' ? item.type : undefined,
            weight: item.weight ? parseInt(item.weight) : undefined,
            remark: item.remark || undefined
          }
        })
      } else {
        // Create multiple PRs
        for (const item of prItems) {
          await apiRequest('/api/pull-requests', {
            method: 'POST',
            body: {
              action: item.action,
              word: item.word,
              oldWord: item.action === 'Change' ? item.oldWord : undefined,
              code: item.code,
              type: item.action !== 'Delete' ? item.type : undefined,
              weight: item.weight ? parseInt(item.weight) : undefined,
              remark: item.remark || undefined,
              batchId
            }
          })
        }
      }

      handleClose()
      onSuccess()
    } catch (err) {
      const error = err as Error
      alert(error.message || (isEditMode ? '更新失败' : '创建失败'))
    } finally {
      setSubmitting(false)
    }
  }

  const handleClose = () => {
    setPRItems([{
      id: '1',
      action: 'Create',
      word: '',
      oldWord: '',
      code: '',
      type: 'Phrase',
      weight: '',
      remark: '',
      conflict: null,
      hasChecked: false,
      checking: false
    }])
    onClose()
  }

  const applySuggestion = (itemId: string, suggestion: ConflictInfo['suggestions'][0]) => {
    const item = prItems.find(i => i.id === itemId)
    if (!item) return

    if (suggestion.action === 'Adjust' && suggestion.toCode) {
      // Apply Adjust suggestion: use alternative code
      updatePRItem(itemId, { code: suggestion.toCode, hasChecked: false, conflict: null })
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} size="4xl" scrollBehavior="inside">
      <ModalContent className="max-h-[90vh]">
        <ModalHeader>
          <div className="flex justify-between items-center w-full">
            <span>{isEditMode ? '编辑修改提议' : '批量添加修改提议'}</span>
            {!isEditMode && prItems.length > 0 && (
              <Chip size="sm" variant="flat">{prItems.length} 个修改</Chip>
            )}
          </div>
        </ModalHeader>
        <ModalBody className="gap-4 overflow-y-auto py-4 pb-0">
          {prItems.map((item, index) => (
            <Card key={item.id} className="border-2 min-h-100 shrink-0">
              <CardHeader className="flex justify-between">
                <span className="font-semibold">修改 #{index + 1}</span>
                {!isEditMode && prItems.length > 1 && (
                  <Button
                    size="sm"
                    color="danger"
                    variant="light"
                    onPress={() => removePRItem(item.id)}
                  >
                    删除
                  </Button>
                )}
              </CardHeader>
              <CardBody className="gap-3">
                <Select
                  label="操作类型"
                  selectedKeys={[item.action]}
                  onChange={(e) => updatePRItem(item.id, { action: e.target.value as 'Create' | 'Change' | 'Delete' })}
                  isRequired
                >
                  <SelectItem key="Create">新增词条</SelectItem>
                  <SelectItem key="Change">修改词</SelectItem>
                  <SelectItem key="Delete">删除词条</SelectItem>
                </Select>

                {item.action === 'Change' ? (
                  <>
                    <div className="flex gap-2">
                      <Input
                        label="旧词"
                        placeholder="当前编码对应的词"
                        value={item.oldWord}
                        onValueChange={(v) => updatePRItem(item.id, { oldWord: v })}
                        isRequired
                        className="flex-1"
                      />
                      <Input
                        label="编码"
                        placeholder="请输入编码"
                        value={item.code}
                        onValueChange={(v) => updatePRItem(item.id, { code: v })}
                        isRequired
                        className="flex-1"
                      />
                    </div>
                    <Input
                      label="新词"
                      placeholder="请输入新词"
                      value={item.word}
                      onValueChange={(v) => updatePRItem(item.id, { word: v })}
                      isRequired
                    />
                  </>
                ) : (
                  <div className="flex gap-2">
                    <Input
                      label="词"
                      placeholder="请输入词"
                      value={item.word}
                      onValueChange={(v) => updatePRItem(item.id, { word: v })}
                      isRequired
                      className="flex-1"
                    />
                    <Input
                      label="编码"
                      placeholder="请输入编码"
                      value={item.code}
                      onValueChange={(v) => updatePRItem(item.id, { code: v })}
                      isRequired
                      className="flex-1"
                    />
                  </div>
                )}

                {item.action !== 'Delete' && (
                  <div className="flex gap-2">
                    <Select
                      label="类型"
                      selectedKeys={[item.type]}
                      onChange={(e) => updatePRItem(item.id, { type: e.target.value })}
                      className="flex-1"
                    >
                      <SelectItem key="Single">单字</SelectItem>
                      <SelectItem key="Phrase">词组</SelectItem>
                      <SelectItem key="Sentence">短句</SelectItem>
                      <SelectItem key="Symbol">符号</SelectItem>
                      <SelectItem key="Link">链接</SelectItem>
                      <SelectItem key="Poem">诗句</SelectItem>
                      <SelectItem key="Other">其他</SelectItem>
                    </Select>
                    <Input
                      label="权重"
                      type="number"
                      placeholder="可选"
                      value={item.weight}
                      onValueChange={(v) => updatePRItem(item.id, { weight: v })}
                      className="flex-1"
                    />
                  </div>
                )}

                <Textarea
                  label="备注"
                  placeholder="可选，说明修改原因"
                  value={item.remark}
                  onValueChange={(v) => updatePRItem(item.id, { remark: v })}
                  minRows={2}
                />

                {item.conflict && (
                  <Card className={item.conflict.hasConflict ? 'border-warning' : 'border-success'}>
                    <CardBody className="max-h-75 overflow-y-auto">
                      {item.conflict.hasConflict ? (
                        <div>
                          <Chip color="warning" variant="flat" size="sm" className="mb-2">
                            ⚠️ 冲突
                          </Chip>
                          <p className="text-small mb-2">{item.conflict.impact}</p>
                          {item.conflict.currentPhrase && (
                            <div className="mb-2 p-2 bg-default-100 rounded text-small">
                              当前: {item.conflict.currentPhrase.word} @ {item.conflict.currentPhrase.code} (权重: {item.conflict.currentPhrase.weight})
                            </div>
                          )}
                          {item.conflict.suggestions.map((sug, idx) => (
                            <div key={idx} className="mb-1 p-2 bg-primary-50 dark:bg-primary-100/10 rounded text-small flex justify-between items-start">
                              <div className="flex-1">
                                <p className="font-medium">
                                  {sug.action === 'Move' ? '移动' :
                                    sug.action === 'Adjust' ? '调整' :
                                      sug.action === 'Resolved' ? '已解决' : '取消'}
                                </p>
                                <p className="text-default-500">{sug.reason}</p>
                                {sug.toCode && <p className="text-primary">建议: {sug.toCode}</p>}
                              </div>
                              {sug.toCode && sug.action === 'Adjust' && (
                                <Button size="sm" variant="flat" color="primary" onPress={() => applySuggestion(item.id, sug)}>
                                  应用
                                </Button>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <Chip color="success" variant="flat" size="sm">✓</Chip>
                            <span className="text-small">无冲突</span>
                          </div>
                          {item.conflict.impact && (
                            <p className="text-small text-success-600 dark:text-success-400">
                              💡 {item.conflict.impact}
                            </p>
                          )}
                          {item.conflict.suggestions.length > 0 && (
                            <div className="mt-2 space-y-1">
                              {item.conflict.suggestions.map((sug, idx) => (
                                <div key={idx} className="p-2 bg-success-50 dark:bg-success-100/10 rounded text-small">
                                  <p className="font-medium text-success-700 dark:text-success-400">
                                    {sug.action === 'Resolved' ? '✓ 已解决' : sug.action}
                                  </p>
                                  <p className="text-default-600 dark:text-default-400">{sug.reason}</p>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </CardBody>
                  </Card>
                )}
              </CardBody>
            </Card>
          ))}

          {!isEditMode && (
            <Button
              color="primary"
              variant="bordered"
              onPress={addPRItem}
              fullWidth
              className="mt-2 mb-4 shrink-0"
            >
              + 添加另一个修改
            </Button>
          )}
        </ModalBody>
        <ModalFooter className="flex-col gap-2">
          <Button
            color="secondary"
            variant="flat"
            onPress={handleCheckAllConflicts}
            isLoading={checkingAll}
            fullWidth
          >
            🔍 检测所有冲突
          </Button>
          <div className="flex gap-2 w-full">
            <Button variant="light" onPress={handleClose} className="flex-1">
              取消
            </Button>
            <Button
              color="primary"
              onPress={handleSubmit}
              isLoading={submitting}
              isDisabled={prItems.some(item => !item.hasChecked || item.conflict?.hasConflict)}
              className="flex-1"
            >
              {isEditMode ? '保存' : `批量创建 (${prItems.length}个)`}
            </Button>
          </div>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
