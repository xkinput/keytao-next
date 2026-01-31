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
  Chip,
  RadioGroup,
  Radio
} from '@heroui/react'
import { apiRequest } from '@/lib/hooks/useSWR'
import { getPhraseTypeOptions, getDefaultWeight, type PhraseType } from '@/lib/constants/phraseTypes'
import { useUIStore } from '@/lib/store/ui'

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
  batchPRs?: Array<{
    id: number
    word: string
    oldWord?: string
    code: string
    action: 'Create' | 'Change' | 'Delete'
    type?: string
    weight?: number
    remark?: string
  }>
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
  prId?: number // Original PR ID for batch edit mode
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
  batchPRs,
  onSuccess
}: CreatePRModalProps) {
  const isEditMode = !!editPR
  const isBatchEditMode = !!batchPRs && batchPRs.length > 0
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
  const [originalPRIds, setOriginalPRIds] = useState<number[]>([])
  const { openAlert, openConfirm } = useUIStore()

  // Reset when modal opens/closes or editPR/batchPRs changes
  useEffect(() => {
    if (isOpen) {
      if (batchPRs && batchPRs.length > 0) {
        // Batch edit mode: load all PRs from the batch
        const loadedItems = batchPRs.map((pr) => ({
          id: `pr-${pr.id}`,
          prId: pr.id,
          action: pr.action,
          word: pr.word,
          oldWord: pr.oldWord || '',
          code: pr.code,
          type: pr.type || 'Phrase',
          weight: pr.weight?.toString() || '',
          remark: pr.remark || '',
          conflict: null,
          hasChecked: false,
          checking: false
        }))
        setPRItems(loadedItems)
        setOriginalPRIds(batchPRs.map(pr => pr.id))
      } else if (editPR) {
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
        setOriginalPRIds([])
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
        setOriginalPRIds([])
      }
    }
  }, [batchPRs, editPR, isOpen])

  const updatePRItem = (id: string, updates: Partial<PRItem>) => {
    setPRItems(items => items.map(item => {
      if (item.id === id) {
        const newItem = { ...item, ...updates }
        // If type changed and weight is default or empty, update to new default
        if ('type' in updates && updates.type) {
          const currentWeight = parseInt(item.weight) || 0
          const oldDefaultWeight = getDefaultWeight(item.type as PhraseType)
          if (!item.weight || currentWeight === oldDefaultWeight) {
            newItem.weight = getDefaultWeight(updates.type as PhraseType).toString()
          }
        }
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
        openAlert(`请填写完整的词和编码（修改 #${item.id}）`, '验证错误')
        return
      }
      if (item.action === 'Change' && !item.oldWord) {
        openAlert(`修改操作需要填写旧词（修改 #${item.id}）`, '验证错误')
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
            weight: item.weight ? parseInt(item.weight) : undefined,
            type: item.type
          }))
        },
        withAuth: true
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
      openAlert(error.message || '检测失败', '检测失败')
    } finally {
      setCheckingAll(false)
    }
  }

  const handleSubmit = async () => {
    // Validate all items
    for (const item of prItems) {
      if (!item.word || !item.code) {
        openAlert(`请填写完整的词和编码（项目 #${item.id}）`, '验证错误')
        return
      }
      if (item.action === 'Change' && !item.oldWord) {
        openAlert(`修改操作需要填写旧词（项目 #${item.id}）`, '验证错误')
        return
      }
      if (!item.hasChecked) {
        openAlert(`请先检测冲突（项目 #${item.id}）`, '操作提示')
        return
      }
      // Check if conflict is truly blocking (not resolved by batch)
      const isResolved = item.conflict?.suggestions?.some(sug => sug.action === 'Resolved')
      if (item.conflict?.hasConflict && !isResolved) {
        openAlert(`存在冲突，请解决后再提交（项目 #${item.id}）`, '存在冲突')
        return
      }
    }

    // Collect items that need confirmation
    const itemsNeedingConfirmation: string[] = []

    for (const item of prItems) {
      // Skip if conflict is resolved by batch
      const isResolved = item.conflict?.suggestions?.some(sug => sug.action === 'Resolved')

      // Check for duplicate code (重码) in Create action
      if (item.action === 'Create' && item.conflict?.currentPhrase && !isResolved) {
        // Extract suggested weight from impact message
        const match = item.conflict.impact?.match(/权重: (\d+)/);
        const actualWeight = match ? match[1] : (item.conflict.currentPhrase.weight + 1).toString();

        itemsNeedingConfirmation.push(
          `📍 项目 #${item.id} - 创建重码警告:\n` +
          `   编码: ${item.code}\n` +
          `   现有词条: ${item.conflict.currentPhrase.word} (权重: ${item.conflict.currentPhrase.weight})\n` +
          `   新增词条: ${item.word} (权重: ${actualWeight})\n` +
          `   ⚠️ 这将创建重码（同一编码对应多个词条）！`
        )
      }

      // Check for Change action - warn about removal
      if (item.action === 'Change' && item.oldWord) {
        itemsNeedingConfirmation.push(
          `📍 项目 #${item.id} - 修改操作警告:\n` +
          `   将移除: "${item.oldWord}" @ "${item.code}"\n` +
          `   替换为: "${item.word}" @ "${item.code}"\n` +
          `   💡 如果 "${item.oldWord}" 仍然需要，请考虑:\n` +
          `      1. 为它创建新的词条并分配其他编码\n` +
          `      2. 或者使用"创建"操作添加新词，而不是"修改"`
        )
      }
    }

    // Show confirmation dialog if needed
    if (itemsNeedingConfirmation.length > 0) {
      const message =
        '⚠️ 重要提示 - 请仔细阅读以下警告\n\n' +
        itemsNeedingConfirmation.join('\n\n' + '─'.repeat(50) + '\n\n') +
        '\n\n' + '═'.repeat(50) + '\n' +
        '确认要继续提交吗？'

      openConfirm(message, async () => {
        await doSubmit()
      }, '确认提交', '确认提交', '取消')
      return
    }

    await doSubmit()
  }

  const doSubmit = async () => {
    setSubmitting(true)
    try {
      if (isBatchEditMode) {
        // Batch edit mode: use sync API
        await apiRequest(`/api/batches/${batchId}/pull-requests`, {
          method: 'PUT',
          body: {
            items: prItems.map(item => ({
              id: item.prId, // Existing PR ID if any
              action: item.action,
              word: item.word,
              oldWord: item.action === 'Change' ? item.oldWord : undefined,
              code: item.code,
              type: item.action !== 'Delete' ? item.type : undefined,
              // If weight is not specified, send undefined/null so backend can auto-calc based on batch context
              weight: item.weight ? parseInt(item.weight) : undefined,
              remark: item.remark || undefined
            }))
          },
          withAuth: true
        })

      } else if (isEditMode && editPR) {
        // Single edit mode (backward compatibility)
        const item = prItems[0]
        await apiRequest(`/api/pull-requests/${editPR.id}`, {
          method: 'PATCH',
          body: {
            action: item.action,
            word: item.word,
            oldWord: item.action === 'Change' ? item.oldWord : undefined,
            code: item.code,
            type: item.action !== 'Delete' ? item.type : undefined,
            // If weight is not specified, use default weight for the type
            weight: item.weight ? parseInt(item.weight) : (item.action !== 'Delete' ? getDefaultWeight(item.type as PhraseType) : undefined),
            remark: item.remark || undefined
          },
          withAuth: true
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
              // If weight is not specified, use default weight for the type
              weight: item.weight ? parseInt(item.weight) : (item.action !== 'Delete' ? getDefaultWeight(item.type as PhraseType) : undefined),
              remark: item.remark || undefined,
              batchId
            },
            withAuth: true
          })
        }
      }

      handleClose()
      onSuccess()
    } catch (err) {
      const error = err as Error
      openAlert(error.message || (isBatchEditMode ? '更新失败' : isEditMode ? '更新失败' : '创建失败'), '提交失败')
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
    <>
      <Modal isOpen={isOpen} onClose={handleClose} size="4xl" scrollBehavior="inside">
        <ModalContent className="max-h-[90vh]">
          <ModalHeader>
            <div className="flex justify-between items-center w-full">
              <span>{isBatchEditMode ? '编辑修改提议' : isEditMode ? '编辑修改提议' : '批量添加修改提议'}</span>
              {prItems.length > 0 && (
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
                  <RadioGroup
                    orientation="horizontal"
                    value={item.action}
                    onValueChange={(value) => updatePRItem(item.id, { action: value as 'Create' | 'Change' | 'Delete' })}
                    isRequired
                    size="sm"
                    classNames={{
                      wrapper: "gap-3",
                    }}
                  >
                    <Radio
                      value="Create"
                      classNames={{
                        base: "inline-flex m-0 bg-content1 hover:bg-content2 items-center justify-between flex-row-reverse max-w-full cursor-pointer rounded-lg gap-4 p-4 border-2 border-transparent data-[selected=true]:border-primary",
                      }}
                    >
                      <div className="flex flex-col gap-1">
                        <span className="text-small font-semibold">新增词条</span>
                        <span className="text-tiny text-default-400">创建新的词典条目</span>
                      </div>
                    </Radio>
                    <Radio
                      value="Change"
                      classNames={{
                        base: "inline-flex m-0 bg-content1 hover:bg-content2 items-center justify-between flex-row-reverse max-w-full cursor-pointer rounded-lg gap-4 p-4 border-2 border-transparent data-[selected=true]:border-primary",
                      }}
                    >
                      <div className="flex flex-col gap-1">
                        <span className="text-small font-semibold">修改词</span>
                        <span className="text-tiny text-default-400">按编码更改现有词条</span>
                      </div>
                    </Radio>
                    <Radio
                      value="Delete"
                      classNames={{
                        base: "inline-flex m-0 bg-content1 hover:bg-content2 items-center justify-between flex-row-reverse max-w-full cursor-pointer rounded-lg gap-4 p-4 border-2 border-transparent data-[selected=true]:border-primary",
                      }}
                    >
                      <div className="flex flex-col gap-1">
                        <span className="text-small font-semibold">删除词条</span>
                        <span className="text-tiny text-default-400">移除词典条目</span>
                      </div>
                    </Radio>
                  </RadioGroup>

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
                        defaultSelectedKeys={[item.type]}
                        selectedKeys={[item.type]}
                        onSelectionChange={(keys) => {
                          const selected = Array.from(keys)[0] as string
                          updatePRItem(item.id, { type: selected })
                        }}
                        multiple={false}
                        disallowEmptySelection
                        className="flex-1"
                      >
                        {getPhraseTypeOptions().map(option => (
                          <SelectItem key={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </Select>
                      <Input
                        label="权重"
                        type="number"
                        placeholder={`默认: ${getDefaultWeight(item.type as PhraseType)}​`}
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
                    <Card className={item.conflict.hasConflict ? 'border-warning' :
                      item.conflict.currentPhrase && item.action === 'Create' ? 'border-warning' : 'border-success'}>
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
                        ) : item.conflict.currentPhrase && item.action === 'Create' ? (
                          // Check if this conflict is resolved by other items in the batch
                          item.conflict.suggestions.some(sug => sug.action === 'Resolved') ? (
                            <div>
                              <div className="flex items-center gap-2 mb-2">
                                <Chip color="success" variant="flat" size="sm">✓ 已解决</Chip>
                              </div>
                              {item.conflict.impact && (
                                <p className="text-small text-success-600 dark:text-success-400 mb-2">
                                  💡 {item.conflict.impact}
                                </p>
                              )}
                              {item.conflict.suggestions.length > 0 && (
                                <div className="mt-2 space-y-1">
                                  {item.conflict.suggestions.map((sug, idx) => (
                                    <div key={idx} className="p-2 bg-success-50 dark:bg-success-100/10 rounded text-small">
                                      <p className="font-medium text-success-700 dark:text-success-400">
                                        ✓ {sug.reason}
                                      </p>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ) : (
                            <div>
                              <Chip color="warning" variant="flat" size="sm" className="mb-2">
                                ⚠️ 重码警告
                              </Chip>
                              <p className="text-small mb-2 text-warning-600 dark:text-warning-400">
                                {item.conflict.impact || '此编码已存在其他词条，将创建重码'}
                              </p>
                              <div className="mb-2 p-2 bg-warning-50 dark:bg-warning-100/10 rounded text-small">
                                <p className="font-medium text-warning-700 dark:text-warning-400">现有词条:</p>
                                <p>{item.conflict.currentPhrase.word} @ {item.conflict.currentPhrase.code} (权重: {item.conflict.currentPhrase.weight})</p>
                              </div>
                              <div className="p-2 bg-warning-50 dark:bg-warning-100/10 rounded text-small">
                                <p className="font-medium text-warning-700 dark:text-warning-400">即将创建:</p>
                                <p>{item.word} @ {item.code} (权重: {(() => {
                                  // Extract suggested weight from impact message
                                  const match = item.conflict.impact?.match(/权重: (\d+)/);
                                  if (match) return match[1];
                                  // Fallback: calculate based on current phrase weight
                                  return item.conflict.currentPhrase.weight + 1;
                                })()})</p>
                              </div>
                              {item.conflict.suggestions.length > 0 && (
                                <div className="mt-2 space-y-1">
                                  <p className="text-small font-medium">建议:</p>
                                  {item.conflict.suggestions.map((sug, idx) => (
                                    <div key={idx} className="p-2 bg-primary-50 dark:bg-primary-100/10 rounded text-small flex justify-between items-start">
                                      <div className="flex-1">
                                        <p className="text-default-600 dark:text-default-400">{sug.reason}</p>
                                        {sug.toCode && <p className="text-primary">建议编码: {sug.toCode}</p>}
                                      </div>
                                      {sug.toCode && sug.action === 'Adjust' && (
                                        <Button size="sm" variant="flat" color="primary" onPress={() => applySuggestion(item.id, sug)}>
                                          应用
                                        </Button>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )
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
              {!isEditMode && (
                <Button
                  color="primary"
                  variant="bordered"
                  onPress={addPRItem}
                >
                  + 添加
                </Button>
              )}
              <Button variant="light" onPress={handleClose} className="flex-1">
                取消
              </Button>
              <Button
                color="primary"
                onPress={handleSubmit}
                isLoading={submitting}
                isDisabled={prItems.some(item => {
                  const isResolved = item.conflict?.suggestions?.some(sug => sug.action === 'Resolved')
                  return !item.hasChecked || (item.conflict?.hasConflict && !isResolved)
                })}
                className="flex-1"
              >
                {isBatchEditMode ? '保存修改' : isEditMode ? '保存' : `批量创建 (${prItems.length}个)`}
              </Button>
            </div>
          </ModalFooter>
        </ModalContent>
      </Modal>

    </>
  )
}
