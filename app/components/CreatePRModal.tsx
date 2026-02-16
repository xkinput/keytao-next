'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useForm, useFieldArray, Controller } from 'react-hook-form'
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
  Radio,
  Tooltip
} from '@heroui/react'
import toast from 'react-hot-toast'
import { apiRequest } from '@/lib/hooks/useSWR'
import { getPhraseTypeOptions, getDefaultWeight, checkTypeMismatch, detectPhraseType, type PhraseType } from '@/lib/constants/phraseTypes'
import { CODE_PATTERN } from '@/lib/constants/codeValidation'
import { useUIStore } from '@/lib/store/ui'
import { Trash2, FileText, CornerUpLeft, CornerDownLeft, ChevronUp, ChevronDown, Plus, Edit2, AlertTriangle, Eye, Check, Lightbulb, Search } from 'lucide-react'
import CodePhrasesPopover from './CodePhrasesPopover'
import WordCodesPopover from './WordCodesPopover'

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
  onSuccess: () => void | Promise<void>
}

interface ConflictInfo {
  hasConflict: boolean
  code: string
  currentPhrase?: {
    word: string
    code: string
    weight: number
    type?: string
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

// Form data managed by react-hook-form
interface FormItem {
  action: 'Create' | 'Change' | 'Delete'
  word: string
  oldWord: string
  code: string
  type: string
  weight: string
  remark: string
}

// Meta state managed separately
interface MetaState {
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
  const { openAlert, openConfirm } = useUIStore()

  // Default form item
  const defaultFormItem: FormItem = useMemo(() => ({
    action: 'Create',
    word: '',
    oldWord: '',
    code: '',
    type: 'Phrase',
    weight: '',
    remark: ''
  }), [])

  // React Hook Form setup
  const { control, handleSubmit, watch, setValue, getValues, reset, trigger, formState } = useForm<{
    items: FormItem[]
  }>({
    mode: 'onChange',
    defaultValues: {
      items: [defaultFormItem]
    }
  })

  const { fields, append, remove, insert } = useFieldArray({
    control,
    name: 'items'
  })

  // Meta states (conflict detection, checking status)
  const [metaStates, setMetaStates] = useState<Map<string, MetaState>>(new Map())
  const [submitting, setSubmitting] = useState(false)
  const [checkingAll, setCheckingAll] = useState(false)
  const [showDictParser, setShowDictParser] = useState(false)
  const [dictInput, setDictInput] = useState('')

  // Track if we've initialized the form in this modal session
  const hasInitializedRef = useRef(false)

  // Refs for scrolling to conflict items
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  // Track current issue index for navigation
  const [currentIssueIndex, setCurrentIssueIndex] = useState<number>(-1)

  // Helper functions for meta state management
  const getMeta = (fieldId: string): MetaState => {
    return metaStates.get(fieldId) || {
      conflict: null,
      hasChecked: false,
      checking: false
    }
  }

  const updateMeta = (fieldId: string, updates: Partial<MetaState>) => {
    setMetaStates(prev => {
      const next = new Map(prev)
      const current = prev.get(fieldId) || { conflict: null, hasChecked: false, checking: false }
      next.set(fieldId, { ...current, ...updates })
      return next
    })
  }

  // Calculate conflict and warning statistics
  const conflictStats = useMemo(() => {
    const checkedCount = fields.filter(field => {
      const meta = metaStates.get(field.id)
      return meta?.hasChecked
    }).length

    if (checkedCount === 0) {
      return { hasChecked: false, conflictCount: 0, warningCount: 0 }
    }

    let conflictCount = 0
    let warningCount = 0

    fields.forEach((field, index) => {
      const meta = metaStates.get(field.id)
      if (!meta?.hasChecked) return

      const isResolved = meta.conflict?.suggestions?.some(sug => sug.action === 'Resolved')
      const action = watch(`items.${index}.action`)

      // Conflict: has conflict and not resolved
      if (meta.conflict?.hasConflict && !isResolved) {
        conflictCount++
      }
      // Warning: Create action with existing phrase (重码警告) but not a hard conflict
      else if (meta.conflict?.currentPhrase && action === 'Create' && !isResolved) {
        warningCount++
      }
    })

    return { hasChecked: true, conflictCount, warningCount }
  }, [fields, metaStates, watch])

  // Reset when modal opens/closes - only initialize once per modal session
  useEffect(() => {
    if (isOpen && !hasInitializedRef.current) {
      // First time opening in this session - initialize form
      if (batchPRs && batchPRs.length > 0) {
        // Batch edit mode: load all PRs from the batch
        const items: FormItem[] = batchPRs.map((pr) => ({
          action: pr.action,
          word: pr.word,
          oldWord: pr.oldWord || '',
          code: pr.code,
          type: pr.type || 'Phrase',
          weight: pr.weight?.toString() || '',
          remark: pr.remark || ''
        }))
        reset({ items }, { keepDirty: false })

        // Initialize empty meta states (will be populated as needed)
        setMetaStates(new Map())
      } else if (editPR) {
        reset({
          items: [{
            action: editPR.action,
            word: editPR.word,
            oldWord: editPR.oldWord || '',
            code: editPR.code,
            type: editPR.type || 'Phrase',
            weight: editPR.weight?.toString() || '',
            remark: editPR.remark || ''
          }]
        }, { keepDirty: false })
        setMetaStates(new Map())
      } else {
        reset({ items: [defaultFormItem] }, { keepDirty: false })
        setMetaStates(new Map())
      }

      hasInitializedRef.current = true
    } else if (!isOpen) {
      // Modal closed - reset the initialization flag for next open
      hasInitializedRef.current = false
    }
  }, [isOpen, batchPRs, editPR, reset, defaultFormItem])

  // Add new item
  const handleAddItem = () => {
    append(defaultFormItem)
    // Add meta state for new item  (setTimeout to wait for field to be created)
    setTimeout(() => {
      const newField = fields[fields.length]
      if (newField) {
        updateMeta(newField.id, {
          conflict: null,
          hasChecked: false,
          checking: false
        })
      }
    }, 0)
  }

  // Remove item
  const handleRemoveItem = (index: number) => {
    if (fields.length > 1) {
      const fieldId = fields[index].id
      remove(index)
      setMetaStates(prev => {
        const next = new Map(prev)
        next.delete(fieldId)
        return next
      })
    }
  }

  // Add item above
  const handleAddItemAbove = (index: number) => {
    insert(index, defaultFormItem)
    setTimeout(() => {
      const newField = fields[index]
      if (newField) {
        updateMeta(newField.id, {
          conflict: null,
          hasChecked: false,
          checking: false
        })
      }
    }, 0)
  }

  // Add item below
  const handleAddItemBelow = (index: number) => {
    insert(index + 1, defaultFormItem)
    setTimeout(() => {
      const newField = fields[index + 1]
      if (newField) {
        updateMeta(newField.id, {
          conflict: null,
          hasChecked: false,
          checking: false
        })
      }
    }, 0)
  }

  // Parse dictionary format
  const handleParseDictionary = () => {
    if (!dictInput.trim()) {
      openAlert('请输入词典内容', '输入为空')
      return
    }

    const lines = dictInput.split('\n').filter(line => line.trim())
    const parsed: FormItem[] = []

    for (const line of lines) {
      const parts = line.split('\t')
      if (parts.length < 2) continue

      const word = parts[0].trim()
      const code = parts[1].trim()

      if (!word || !code) continue

      // Auto-detect type using new detectPhraseType function
      const type = detectPhraseType(word, code)

      // Get default weight for type
      const weight = getDefaultWeight(type)

      parsed.push({
        action: 'Create',
        word,
        oldWord: '',
        code,
        type,
        weight: weight.toString(),
        remark: ''
      })
    }

    if (parsed.length === 0) {
      openAlert('未能解析到有效的词条，请检查格式是否正确（词条[Tab]编码）', '解析失败')
      return
    }

    // Append parsed items to existing items
    parsed.forEach(item => {
      append(item)
    })

    setShowDictParser(false)
    setDictInput('')
    toast.success(`已追加 ${parsed.length} 个词条`)
  }

  // Check all conflicts
  const handleCheckAllConflicts = async () => {
    const formData = getValues()

    // Trigger validation
    const isFormValid = await trigger()
    if (!isFormValid) {
      openAlert('请先修正表单错误', '验证失败')

      // Scroll to first error field
      setTimeout(() => {
        const firstErrorIndex = fields.findIndex((field, index) => {
          const fieldState = formState.errors.items?.[index]
          return fieldState && Object.keys(fieldState).length > 0
        })

        if (firstErrorIndex !== -1) {
          const fieldId = fields[firstErrorIndex].id
          const cardElement = cardRefs.current.get(fieldId)
          if (cardElement) {
            cardElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
          }
        }
      }, 100)

      return
    }

    setCheckingAll(true)

    try {
      const result = await apiRequest('/api/pull-requests/check-conflicts-batch', {
        method: 'POST',
        body: {
          items: formData.items.map((item, idx) => ({
            id: fields[idx].id,
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

      // Update meta states with conflict results
      result.results.forEach(({ id, conflict }) => {
        updateMeta(id, {
          conflict,
          hasChecked: true,
          checking: false
        })
      })

      // Scroll to first conflict if any
      setTimeout(() => {
        const firstConflictIndex = result.results.findIndex(({ conflict }) => {
          const isResolved = conflict.suggestions?.some(sug => sug.action === 'Resolved')
          return conflict.hasConflict && !isResolved
        })

        if (firstConflictIndex !== -1) {
          setCurrentIssueIndex(firstConflictIndex)
          const fieldId = fields[firstConflictIndex].id
          const cardElement = cardRefs.current.get(fieldId)
          if (cardElement) {
            cardElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
          }
        }
      }, 100)
    } catch (err) {
      const error = err as Error
      const message = error.message ? `${error.message}\n请重试` : '检测失败，请重试'
      openAlert(message, '检测失败')
    } finally {
      setCheckingAll(false)
    }
  }

  // Auto-check conflict for a single item (used when filling Change action)
  const autoCheckConflictForItem = async (itemIndex: number, fieldId: string) => {
    const currentData = getValues(`items.${itemIndex}`)
    const meta = getMeta(fieldId)

    // Only auto-check for Change action when oldWord and code are filled
    if (currentData.action !== 'Change' || !currentData.oldWord || !currentData.code || meta.hasChecked) {
      return
    }

    updateMeta(fieldId, { checking: true })
    try {
      const result = await apiRequest('/api/pull-requests/check-conflicts-batch', {
        method: 'POST',
        body: {
          items: [{
            id: fieldId,
            action: 'Change',
            word: currentData.word,
            oldWord: currentData.oldWord,
            code: currentData.code,
            weight: currentData.weight ? parseInt(currentData.weight) : undefined,
            type: currentData.type
          }]
        },
        withAuth: true
      }) as { results: Array<{ id: string; conflict: ConflictInfo }> }

      const conflictData = result.results[0]
      if (conflictData) {
        updateMeta(fieldId, {
          conflict: conflictData.conflict,
          hasChecked: true,
          checking: false
        })
      }
    } catch {
      updateMeta(fieldId, { checking: false })
    }
  }

  // Submit handler renamed to avoid conflict
  const onSubmitForm = handleSubmit(async (data) => {
    // Validate all items have been checked
    for (let i = 0; i < fields.length; i++) {
      const meta = getMeta(fields[i].id)
      if (!meta.hasChecked) {
        openAlert(`请先检测冲突（项目 #${i + 1}）`, '操作提示')
        return
      }

      const isResolved = meta.conflict?.suggestions?.some((sug) => sug.action === 'Resolved')
      if (meta.conflict?.hasConflict && !isResolved) {
        openAlert(`存在冲突，请解决后再提交（项目 #${i + 1}）`, '存在冲突')
        return
      }
    }

    // Collect items that need confirmation
    const itemsNeedingConfirmation: string[] = []

    for (let i = 0; i < fields.length; i++) {
      const item = data.items[i]
      const meta = getMeta(fields[i].id)

      // Skip if conflict is resolved by batch
      const isResolved = meta.conflict?.suggestions?.some((sug) => sug.action === 'Resolved')

      // Check for Create action warnings
      if (item.action === 'Create' && meta.conflict?.currentPhrase && !isResolved) {
        const isWordDuplicate =
          meta.conflict.currentPhrase.word === item.word &&
          meta.conflict.currentPhrase.code !== item.code

        if (isWordDuplicate) {
          itemsNeedingConfirmation.push(
            `▶ 项目 #${i + 1} - 词条重复警告:\n` +
            `   词条: ${item.word}\n` +
            `   已存在编码: ${meta.conflict.currentPhrase.code}\n` +
            `   新增编码: ${item.code}\n` +
            `   ! 同一词条将拥有多个编码！`
          )
        } else {
          // Extract suggested weight from impact message
          const match = meta.conflict.impact?.match(/权重: (\d+)/)
          const actualWeight = match ? match[1] : (meta.conflict.currentPhrase.weight + 1).toString()

          itemsNeedingConfirmation.push(
            `▶ 项目 #${i + 1} - 创建重码警告:\n` +
            `   编码: ${item.code}\n` +
            `   现有词条: ${meta.conflict.currentPhrase.word} (权重: ${meta.conflict.currentPhrase.weight})\n` +
            `   新增词条: ${item.word} (权重: ${actualWeight})\n` +
            `   ! 这将创建重码（同一编码对应多个词条）！`
          )
        }
      }

      // Check for Change action - warn about removal
      if (item.action === 'Change' && item.oldWord) {
        itemsNeedingConfirmation.push(
          `▸ 项目 #${i + 1} - 修改操作警告:\n` +
          `   将移除: "${item.oldWord}" @ "${item.code}"\n` +
          `   替换为: "${item.word}" @ "${item.code}"\n` +
          `   i 如果 "${item.oldWord}" 仍然需要，请考虑:\n` +
          `      1. 为它创建新的词条并分配其他编码\n` +
          `      2. 或者使用"创建"操作添加新词，而不是"修改"`
        )
      }
    }

    // Show confirmation dialog if needed
    if (itemsNeedingConfirmation.length > 0) {
      const message =
        '! 重要提示 - 请仔细阅读以下警告\n\n' +
        itemsNeedingConfirmation.join('\n\n' + '─'.repeat(50) + '\n\n') +
        '确认要继续提交吗？'

      openConfirm(message, async () => {
        await doSubmit(data)
      }, '确认提交', '确认提交', '取消')
      return
    }

    await doSubmit(data)
  })

  const doSubmit = async (data: { items: FormItem[] }) => {
    setSubmitting(true)
    try {
      if (isBatchEditMode) {
        // Batch edit mode: use sync API
        await apiRequest(`/api/batches/${batchId}/pull-requests`, {
          method: 'PUT',
          body: {
            items: data.items.map((item, idx) => ({
              id: batchPRs?.[idx]?.id, // Existing PR ID from batchPRs
              action: item.action,
              word: item.word,
              oldWord: item.action === 'Change' ? item.oldWord : undefined,
              code: item.code,
              type: item.action !== 'Delete' ? item.type : undefined,
              weight: item.weight ? parseInt(item.weight) : undefined,
              remark: item.remark || null
            }))
          },
          withAuth: true
        })

      } else if (isEditMode && editPR) {
        // Single edit mode
        const item = data.items[0]
        await apiRequest(`/api/pull-requests/${editPR.id}`, {
          method: 'PATCH',
          body: {
            action: item.action,
            word: item.word,
            oldWord: item.action === 'Change' ? item.oldWord : undefined,
            code: item.code,
            type: item.action !== 'Delete' ? item.type : undefined,
            weight: item.weight ? parseInt(item.weight) : (item.action !== 'Delete' ? getDefaultWeight(item.type as PhraseType) : undefined),
            remark: item.remark || null
          },
          withAuth: true
        })
      } else {
        // Create multiple PRs in batch
        await apiRequest('/api/pull-requests/batch', {
          method: 'POST',
          body: {
            items: data.items.map(item => ({
              action: item.action,
              word: item.word,
              oldWord: item.action === 'Change' ? item.oldWord : undefined,
              code: item.code,
              type: item.action !== 'Delete' ? item.type : undefined,
              weight: item.weight ? parseInt(item.weight) : (item.action !== 'Delete' ? getDefaultWeight(item.type as PhraseType) : undefined),
              remark: item.remark || null
            })),
            batchId
          },
          withAuth: true
        })
      }

      // Success! Show toast and close
      toast.success(
        isBatchEditMode ? '批量更新成功' : isEditMode ? '更新成功' : `成功创建 ${data.items.length} 个修改提议`
      )

      // Trigger data refresh and wait for it to complete
      await Promise.resolve(onSuccess())

      // Close without confirmation (data is saved)
      onClose()
    } catch (err) {
      const error = err as Error
      openAlert(error.message || (isBatchEditMode ? '更新失败' : isEditMode ? '更新失败' : '创建失败'), '提交失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleClose = () => {
    // Check if there are unsaved changes
    if (formState.isDirty) {
      openConfirm(
        '您有未保存的更改，确定要关闭吗？',
        () => {
          onClose()
        },
        '放弃更改',
        '确定',
        '取消'
      )
    } else {
      onClose()
    }
  }

  const applySuggestion = (fieldIndex: number, suggestion: ConflictInfo['suggestions'][0]) => {
    if (suggestion.action === 'Adjust' && suggestion.toCode) {
      // Apply Adjust suggestion: use alternative code
      setValue(`items.${fieldIndex}.code`, suggestion.toCode)
      // Reset check state
      updateMeta(fields[fieldIndex].id, { hasChecked: false, conflict: null })
    }
  }

  // Navigate to next/previous conflict or warning
  const navigateToIssue = (direction: 'next' | 'prev') => {
    const issueIndices: number[] = []

    fields.forEach((field, index) => {
      const meta = metaStates.get(field.id)
      if (!meta?.hasChecked) return

      const isResolved = meta.conflict?.suggestions?.some(sug => sug.action === 'Resolved')
      const action = watch(`items.${index}.action`)

      // Has conflict or warning
      const hasIssue =
        (meta.conflict?.hasConflict && !isResolved) ||
        (meta.conflict?.currentPhrase && action === 'Create' && !isResolved)

      if (hasIssue) {
        issueIndices.push(index)
      }
    })

    if (issueIndices.length === 0) return

    let nextIndex: number
    if (direction === 'next') {
      // Find next issue after current
      const nextIndices = issueIndices.filter(i => i > currentIssueIndex)
      nextIndex = nextIndices.length > 0 ? nextIndices[0] : issueIndices[0]
    } else {
      // Find previous issue before current
      const prevIndices = issueIndices.filter(i => i < currentIssueIndex)
      nextIndex = prevIndices.length > 0 ? prevIndices[prevIndices.length - 1] : issueIndices[issueIndices.length - 1]
    }

    setCurrentIssueIndex(nextIndex)

    // Scroll to the issue
    const fieldId = fields[nextIndex].id
    const cardElement = cardRefs.current.get(fieldId)
    if (cardElement) {
      cardElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }

  // Calculate current issue position for display
  const currentIssuePosition = useMemo(() => {
    if (currentIssueIndex === -1) return null

    const issueIndices: number[] = []
    fields.forEach((field, index) => {
      const meta = metaStates.get(field.id)
      if (!meta?.hasChecked) return

      const isResolved = meta.conflict?.suggestions?.some(sug => sug.action === 'Resolved')
      const action = watch(`items.${index}.action`)

      const hasIssue =
        (meta.conflict?.hasConflict && !isResolved) ||
        (meta.conflict?.currentPhrase && action === 'Create' && !isResolved)

      if (hasIssue) {
        issueIndices.push(index)
      }
    })

    const position = issueIndices.indexOf(currentIssueIndex)
    if (position === -1) return null

    return {
      current: position + 1,
      total: issueIndices.length
    }
  }, [currentIssueIndex, fields, metaStates, watch])


  return (
    <>
      <Modal isOpen={isOpen} onClose={handleClose} size="4xl" scrollBehavior="inside">
        <ModalContent className="max-h-[90vh]">
          {() => (
            <>
              <ModalHeader>
                <div className="flex justify-between items-center w-full">
                  <span>{isBatchEditMode ? '编辑修改提议' : isEditMode ? '编辑修改提议' : '批量添加修改提议'}</span>
                  {fields.length > 0 && (
                    <Chip size="sm" variant="flat">{fields.length} 个修改</Chip>
                  )}
                </div>
              </ModalHeader>
              <ModalBody className="gap-4 overflow-y-auto py-4 pb-0">
                {fields.map((field, index) => {
                  const meta = getMeta(field.id)
                  return (
                    <Card
                      key={field.id}
                      className="min-h-100 shrink-0"
                      ref={(el: HTMLDivElement | null) => {
                        if (el) {
                          cardRefs.current.set(field.id, el)
                        } else {
                          cardRefs.current.delete(field.id)
                        }
                      }}
                    >
                      <CardHeader className="flex justify-between">
                        <span className="font-semibold">修改 #{index + 1}</span>
                        {!isEditMode && (
                          <div className="flex gap-1 items-center">
                            <div className="flex flex-col gap-0.5">
                              <Tooltip content="上方添加" placement="top">
                                <Button
                                  size="sm"
                                  variant="light"
                                  isIconOnly
                                  className="min-w-unit-7 w-unit-7 h-unit-7"
                                  onPress={() => handleAddItemAbove(index)}
                                >
                                  <CornerUpLeft className='w-3' />
                                </Button>
                              </Tooltip>
                              <Tooltip content="下方添加" placement="bottom">
                                <Button
                                  size="sm"
                                  variant="light"
                                  isIconOnly
                                  className="min-w-unit-7 w-unit-7 h-unit-7"
                                  onPress={() => handleAddItemBelow(index)}
                                >
                                  <CornerDownLeft className='w-3' />
                                </Button>
                              </Tooltip>
                            </div>
                            {fields.length > 1 && (
                              <Button
                                size="sm"
                                color="danger"
                                variant="light"
                                isIconOnly
                                onPress={() => handleRemoveItem(index)}
                              >
                                <Trash2 className='w-4' />
                              </Button>
                            )}
                          </div>
                        )}
                      </CardHeader>
                      <CardBody className="gap-3">
                        <Controller
                          name={`items.${index}.action`}
                          control={control}
                          rules={{ required: true }}
                          render={({ field: actionField }) => (
                            <RadioGroup
                              value={actionField.value}
                              orientation="horizontal"
                              isRequired
                              size="sm"
                              classNames={{
                                wrapper: "gap-3",
                              }}
                              onValueChange={async (value) => {
                                actionField.onChange(value)
                                // Reset check state when action changes
                                updateMeta(field.id, { hasChecked: false, conflict: null })

                                const currentData = getValues(`items.${index}`)

                                // Auto-fill oldWord when switching to Change action
                                if (value === 'Change' && currentData.code) {
                                  // Query the first phrase for this code
                                  if (!currentData.oldWord) {
                                    try {
                                      const response = await fetch(`/api/phrases/by-code?code=${encodeURIComponent(currentData.code)}&page=1`)
                                      if (response.ok) {
                                        const data = await response.json()
                                        if (data.phrases && data.phrases.length > 0) {
                                          // Auto-fill with the first phrase's word
                                          const firstPhrase = data.phrases.find((p: { code: string; word: string }) => p.code === currentData.code)
                                          if (firstPhrase) {
                                            setValue(`items.${index}.oldWord`, firstPhrase.word)
                                          }
                                        }
                                      }
                                    } catch (err) {
                                      console.error('Failed to fetch phrase by code:', err)
                                    }
                                  }

                                  // Always check conflict for Change action when code is present
                                  setTimeout(async () => {
                                    const updatedData = getValues(`items.${index}`)
                                    updateMeta(field.id, { checking: true })
                                    try {
                                      const result = await apiRequest('/api/pull-requests/check-conflicts-batch', {
                                        method: 'POST',
                                        body: {
                                          items: [{
                                            id: field.id,
                                            action: 'Change',
                                            word: updatedData.word,
                                            oldWord: updatedData.oldWord || '',
                                            code: updatedData.code,
                                            weight: updatedData.weight ? parseInt(updatedData.weight) : undefined,
                                            type: updatedData.type
                                          }]
                                        },
                                        withAuth: true
                                      }) as { results: Array<{ id: string; conflict: ConflictInfo }> }

                                      const conflictData = result.results[0]
                                      if (conflictData) {
                                        updateMeta(field.id, {
                                          conflict: conflictData.conflict,
                                          hasChecked: true,
                                          checking: false
                                        })
                                      }
                                    } catch {
                                      updateMeta(field.id, { checking: false })
                                    }
                                  }, 100)
                                }

                                // Auto-check conflict for Create and Delete actions
                                if ((value === 'Create' || value === 'Delete') && currentData.word && currentData.code) {
                                  updateMeta(field.id, { checking: true })
                                  try {
                                    const result = await apiRequest('/api/pull-requests/check-conflicts-batch', {
                                      method: 'POST',
                                      body: {
                                        items: [{
                                          id: field.id,
                                          action: value,
                                          word: currentData.word,
                                          oldWord: undefined,
                                          code: currentData.code,
                                          weight: currentData.weight ? parseInt(currentData.weight) : undefined,
                                          type: currentData.type
                                        }]
                                      },
                                      withAuth: true
                                    }) as { results: Array<{ id: string; conflict: ConflictInfo }> }

                                    const conflictData = result.results[0]
                                    if (conflictData) {
                                      updateMeta(field.id, {
                                        conflict: conflictData.conflict,
                                        hasChecked: true,
                                        checking: false
                                      })
                                    }
                                  } catch {
                                    updateMeta(field.id, { checking: false })
                                  }
                                }
                              }}
                            >
                              <Radio
                                value="Create"
                                color="success"
                                classNames={{
                                  base: "inline-flex m-0 bg-content1 hover:bg-content2 items-center justify-between flex-row-reverse max-w-full cursor-pointer rounded-lg gap-4 p-4 border-2 border-transparent data-[selected=true]:border-success",
                                }}
                              >
                                <div className="flex flex-col gap-1">
                                  <div className="flex items-center gap-2">
                                    <Plus className="w-4 h-4 text-success" />
                                    <span className="text-small font-semibold">新增词条</span>
                                  </div>
                                  <span className="text-tiny text-default-400">创建新的词典条目</span>
                                </div>
                              </Radio>
                              <Radio
                                value="Change"
                                color="warning"
                                classNames={{
                                  base: "inline-flex m-0 bg-content1 hover:bg-content2 items-center justify-between flex-row-reverse max-w-full cursor-pointer rounded-lg gap-4 p-4 border-2 border-transparent data-[selected=true]:border-warning",
                                }}
                              >
                                <div className="flex flex-col gap-1">
                                  <div className="flex items-center gap-2">
                                    <Edit2 className="w-4 h-4 text-warning" />
                                    <span className="text-small font-semibold">修改词</span>
                                  </div>
                                  <span className="text-tiny text-default-400">按编码更改现有词条</span>
                                </div>
                              </Radio>
                              <Radio
                                value="Delete"
                                color="danger"
                                classNames={{
                                  base: "inline-flex m-0 bg-content1 hover:bg-content2 items-center justify-between flex-row-reverse max-w-full cursor-pointer rounded-lg gap-4 p-4 border-2 border-transparent data-[selected=true]:border-danger",
                                }}
                              >
                                <div className="flex flex-col gap-1">
                                  <div className="flex items-center gap-2">
                                    <Trash2 className="w-4 h-4 text-danger" />
                                    <span className="text-small font-semibold">删除词条</span>
                                  </div>
                                  <span className="text-tiny text-default-400">移除词典条目</span>
                                </div>
                              </Radio>
                            </RadioGroup>
                          )}
                        />

                        <Controller
                          name={`items.${index}.action`}
                          control={control}
                          render={({ field: watchField }) => {
                            const currentAction = watchField.value
                            return (
                              <>
                                {currentAction === 'Change' ? (
                                  <>
                                    <div className="flex gap-2">
                                      <Controller
                                        name={`items.${index}.oldWord`}
                                        control={control}
                                        rules={{ required: '旧词不能为空' }}
                                        render={({ field: oldWordField, fieldState }) => (
                                          <Input
                                            value={oldWordField.value}
                                            label="旧词"
                                            placeholder="当前编码对应的词"
                                            isRequired
                                            isInvalid={!!fieldState.error}
                                            errorMessage={fieldState.error?.message}
                                            className="flex-1"
                                            onValueChange={(v) => {
                                              oldWordField.onChange(v)
                                              updateMeta(field.id, { hasChecked: false, conflict: null })
                                            }}
                                            onBlur={() => autoCheckConflictForItem(index, field.id)}
                                            endContent={
                                              oldWordField.value && (
                                                <WordCodesPopover word={oldWordField.value}>
                                                  <Button
                                                    size="sm"
                                                    variant="light"
                                                    isIconOnly
                                                    className="min-w-unit-6 w-6 h-6"
                                                  >
                                                    <Eye className="w-4 h-4" />
                                                  </Button>
                                                </WordCodesPopover>
                                              )
                                            }
                                          />
                                        )}
                                      />
                                      <Controller
                                        name={`items.${index}.code`}
                                        control={control}
                                        rules={{
                                          required: '编码不能为空',
                                          pattern: {
                                            value: CODE_PATTERN,
                                            message: '编码格式错误'
                                          }
                                        }}
                                        render={({ field: codeField, fieldState }) => (
                                          <Input
                                            value={codeField.value}
                                            label="编码"
                                            placeholder="请输入编码"
                                            isRequired
                                            isInvalid={!!fieldState.error}
                                            errorMessage={fieldState.error?.message}
                                            color={fieldState.error ? 'danger' : 'default'}
                                            className="flex-1"
                                            onValueChange={(v) => {
                                              codeField.onChange(v)
                                              updateMeta(field.id, { hasChecked: false, conflict: null })
                                            }}
                                            onBlur={() => autoCheckConflictForItem(index, field.id)}
                                            endContent={
                                              codeField.value && (
                                                <CodePhrasesPopover code={codeField.value}>
                                                  <Button
                                                    size="sm"
                                                    variant="light"
                                                    isIconOnly
                                                    className="min-w-unit-6 w-6 h-6"
                                                  >
                                                    <Eye className="w-4 h-4" />
                                                  </Button>
                                                </CodePhrasesPopover>
                                              )
                                            }
                                          />
                                        )}
                                      />
                                    </div>
                                    <Controller
                                      name={`items.${index}.word`}
                                      control={control}
                                      rules={{ required: '新词不能为空' }}
                                      render={({ field: wordField, fieldState }) => (
                                        <Input
                                          value={wordField.value}
                                          label="新词"
                                          placeholder="请输入新词"
                                          isRequired
                                          isInvalid={!!fieldState.error}
                                          errorMessage={fieldState.error?.message}
                                          onValueChange={(v) => {
                                            wordField.onChange(v)
                                            updateMeta(field.id, { hasChecked: false, conflict: null })
                                          }}
                                          endContent={
                                            wordField.value && (
                                              <WordCodesPopover word={wordField.value}>
                                                <Button
                                                  size="sm"
                                                  variant="light"
                                                  isIconOnly
                                                  className="min-w-unit-6 w-6 h-6"
                                                >
                                                  <Eye className="w-4 h-4" />
                                                </Button>
                                              </WordCodesPopover>
                                            )
                                          }
                                        />
                                      )}
                                    />
                                  </>
                                ) : (
                                  <div className="flex gap-2">
                                    <Controller
                                      name={`items.${index}.word`}
                                      control={control}
                                      rules={{ required: '词不能为空' }}
                                      render={({ field: wordField, fieldState }) => (
                                        <Input
                                          value={wordField.value}
                                          label="词"
                                          placeholder="请输入词"
                                          isRequired
                                          isInvalid={!!fieldState.error}
                                          errorMessage={fieldState.error?.message}
                                          className="flex-1"
                                          onValueChange={(v) => {
                                            wordField.onChange(v)
                                            updateMeta(field.id, { hasChecked: false, conflict: null })
                                          }}
                                          endContent={
                                            wordField.value && (
                                              <WordCodesPopover word={wordField.value}>
                                                <Button
                                                  size="sm"
                                                  variant="light"
                                                  isIconOnly
                                                  className="min-w-unit-6 w-6 h-6"
                                                >
                                                  <Eye className="w-4 h-4" />
                                                </Button>
                                              </WordCodesPopover>
                                            )
                                          }
                                        />
                                      )}
                                    />
                                    <Controller
                                      name={`items.${index}.code`}
                                      control={control}
                                      rules={{
                                        required: '编码不能为空',
                                        pattern: {
                                          value: CODE_PATTERN,
                                          message: '编码格式错误'
                                        }
                                      }}
                                      render={({ field: codeField, fieldState }) => (
                                        <Input
                                          value={codeField.value}
                                          label="编码"
                                          placeholder="请输入编码"
                                          isRequired
                                          isInvalid={!!fieldState.error}
                                          errorMessage={fieldState.error?.message}
                                          color={fieldState.error ? 'danger' : 'default'}
                                          className="flex-1"
                                          onValueChange={(v) => {
                                            codeField.onChange(v)
                                            updateMeta(field.id, { hasChecked: false, conflict: null })
                                          }}
                                          endContent={
                                            codeField.value && (
                                              <CodePhrasesPopover code={codeField.value}>
                                                <Button
                                                  size="sm"
                                                  variant="light"
                                                  isIconOnly
                                                  className="min-w-unit-6 w-6 h-6"
                                                >
                                                  <Eye className="w-4 h-4" />
                                                </Button>
                                              </CodePhrasesPopover>
                                            )
                                          }
                                        />
                                      )}
                                    />
                                  </div>
                                )}

                                {currentAction !== 'Delete' && (
                                  <>
                                    <div className="flex gap-2">
                                      <Controller
                                        name={`items.${index}.type`}
                                        control={control}
                                        render={({ field: typeField }) => (
                                          <Select
                                            label="类型"
                                            selectedKeys={[typeField.value]}
                                            onSelectionChange={(keys) => {
                                              const selected = Array.from(keys)[0] as string
                                              typeField.onChange(selected)
                                            }}
                                            disallowEmptySelection
                                            className="flex-1"
                                          >
                                            {getPhraseTypeOptions().map(option => (
                                              <SelectItem key={option.value}>
                                                {option.label}
                                              </SelectItem>
                                            ))}
                                          </Select>
                                        )}
                                      />
                                      <Controller
                                        name={`items.${index}.weight`}
                                        control={control}
                                        render={({ field: weightField }) => {
                                          const currentType = watch(`items.${index}.type`) as PhraseType
                                          return (
                                            <Input
                                              value={weightField.value}
                                              label="权重"
                                              type="number"
                                              placeholder={`默认: ${getDefaultWeight(currentType)}`}
                                              className="flex-1"
                                              onValueChange={(v) => weightField.onChange(v)}
                                            />
                                          )
                                        }}
                                      />
                                    </div>

                                    {/* Original type info for Change action */}
                                    {(() => {
                                      const currentAction = watch(`items.${index}.action`)
                                      if (currentAction === 'Change' && meta.conflict?.currentPhrase?.type) {
                                        const currentType = watch(`items.${index}.type`) as PhraseType
                                        const originalType = meta.conflict.currentPhrase.type
                                        const originalTypeLabel = getPhraseTypeOptions().find(opt => opt.value === originalType)?.label || originalType
                                        const currentTypeLabel = getPhraseTypeOptions().find(opt => opt.value === currentType)?.label || currentType
                                        const isTypeChanged = originalType !== currentType

                                        return (
                                          <Card className={isTypeChanged ? "border-primary bg-primary-50/50 dark:bg-primary-100/5" : "border-default-200 bg-default-50"}>
                                            <CardBody className="py-2 px-3">
                                              <div className="flex items-center gap-2">
                                                <FileText className="w-4 h-4 text-default-500 shrink-0" />
                                                <p className="text-sm text-default-700 dark:text-default-400">
                                                  原类型: <span className="font-semibold">{originalTypeLabel}</span>
                                                  {isTypeChanged && (
                                                    <>
                                                      {' → '}
                                                      <span className="font-semibold text-primary">{currentTypeLabel}</span>
                                                    </>
                                                  )}
                                                </p>
                                              </div>
                                            </CardBody>
                                          </Card>
                                        )
                                      }
                                      return null
                                    })()}

                                    {/* Type mismatch warning */}
                                    {(() => {
                                      const currentWord = watch(`items.${index}.word`)
                                      const currentCode = watch(`items.${index}.code`)
                                      const currentType = watch(`items.${index}.type`) as PhraseType

                                      if (!currentWord) return null

                                      const typeMismatch = checkTypeMismatch(currentWord, currentCode, currentType)

                                      if (!typeMismatch.hasTypeMismatch) return null

                                      return (
                                        <Card className="border-warning bg-warning-50/50 dark:bg-warning-100/5">
                                          <CardBody className="py-2 px-3">
                                            <div className="flex items-start gap-2">
                                              <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                                              <div className="flex-1 min-w-0">
                                                <p className="text-sm text-warning-700 dark:text-warning-400">
                                                  该词条类型应为 <span className="font-semibold">{typeMismatch.suggestedTypeLabel}</span>
                                                </p>
                                              </div>
                                              <Button
                                                size="sm"
                                                color="warning"
                                                variant="flat"
                                                className="shrink-0"
                                                onPress={() => {
                                                  if (typeMismatch.suggestedType) {
                                                    setValue(`items.${index}.type`, typeMismatch.suggestedType)
                                                    toast.success(`已修改为${typeMismatch.suggestedTypeLabel}`)
                                                  }
                                                }}
                                              >
                                                修改为{typeMismatch.suggestedTypeLabel}
                                              </Button>
                                            </div>
                                          </CardBody>
                                        </Card>
                                      )
                                    })()}
                                  </>
                                )}
                              </>
                            )
                          }}
                        />

                        <Controller
                          name={`items.${index}.remark`}
                          control={control}
                          render={({ field: remarkField }) => (
                            <Textarea
                              value={remarkField.value}
                              label="备注"
                              placeholder="可选，说明修改原因"
                              minRows={2}
                              onValueChange={(v) => remarkField.onChange(v)}
                            />
                          )}
                        />

                        {meta.conflict && (
                          <Card className={meta.conflict.hasConflict ? 'border-danger' :
                            meta.conflict.currentPhrase && watch(`items.${index}.action`) === 'Create' ? 'border-warning' : 'border-success'}>
                            <CardBody className="max-h-75 overflow-y-auto">
                              {meta.conflict.hasConflict ? (
                                <div>
                                  <div className="flex items-center gap-2 mb-2">
                                    <Chip color="danger" variant="flat" size="sm" startContent={<AlertTriangle className="w-3 h-3" />}>
                                      冲突
                                    </Chip>
                                    <p className="text-small">{meta.conflict.impact}</p>
                                  </div>
                                  {meta.conflict.currentPhrase && (
                                    <div className="mb-2 p-2 bg-default-100 rounded text-small">
                                      当前: {meta.conflict.currentPhrase.word} @ {meta.conflict.currentPhrase.code} (权重: {meta.conflict.currentPhrase.weight})
                                    </div>
                                  )}
                                  {meta.conflict.suggestions.map((sug, idx) => (
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
                                        <Button size="sm" variant="flat" color="primary" onPress={() => applySuggestion(index, sug)}>
                                          应用
                                        </Button>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              ) : meta.conflict.currentPhrase && watch(`items.${index}.action`) === 'Create' ? (
                                // Check if this conflict is resolved by other items in the batch
                                meta.conflict.suggestions.some((sug) => sug.action === 'Resolved') ? (
                                  <div>
                                    <div className="flex items-center gap-2 mb-2">
                                      <Chip color="success" variant="flat" size="sm" startContent={<Check className="w-3 h-3" />}>
                                        已解决
                                      </Chip>
                                      {meta.conflict.impact && (
                                        <div className="flex items-center gap-1 text-small text-success-600 dark:text-success-400">
                                          <Lightbulb className="w-3 h-3" />
                                          <span>{meta.conflict.impact}</span>
                                        </div>
                                      )}
                                    </div>
                                    {meta.conflict.suggestions.length > 0 && (
                                      <div className="mt-2 space-y-1">
                                        {meta.conflict.suggestions.map((sug, idx) => (
                                          <div key={idx} className="p-2 bg-success-50 dark:bg-success-100/10 rounded text-small">
                                            <p className="font-medium text-success-700 dark:text-success-400 flex items-center gap-1">
                                              <Check className="w-3 h-3" />
                                              {sug.reason}
                                            </p>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  (() => {
                                    const currentWord = watch(`items.${index}.word`)
                                    const currentCode = watch(`items.${index}.code`)
                                    const isWordDuplicate =
                                      meta.conflict.currentPhrase!.word === currentWord &&
                                      meta.conflict.currentPhrase!.code !== currentCode

                                    return (
                                      <div>
                                        <div className="flex items-center gap-2 mb-2">
                                          <Chip color="warning" variant="flat" size="sm" startContent={<AlertTriangle className="w-3 h-3" />}>
                                            {isWordDuplicate ? '词条重复警告' : '重码警告'}
                                          </Chip>
                                          <p className="text-small text-warning-600 dark:text-warning-400">
                                            {meta.conflict.impact || (isWordDuplicate ? '该词条已存在其他编码，将创建多编码词条' : '此编码已存在其他词条，将创建重码')}
                                          </p>
                                        </div>
                                        <div className="mb-2 p-2 bg-warning-50 dark:bg-warning-100/10 rounded text-small">
                                          <p className="font-medium text-warning-700 dark:text-warning-400">现有词条:</p>
                                          <p>{meta.conflict.currentPhrase!.word} @ {meta.conflict.currentPhrase!.code} (权重: {meta.conflict.currentPhrase!.weight})</p>
                                        </div>
                                        <div className="p-2 bg-warning-50 dark:bg-warning-100/10 rounded text-small">
                                          <p className="font-medium text-warning-700 dark:text-warning-400">即将创建:</p>
                                          {isWordDuplicate ? (
                                            <p>{currentWord} @ {currentCode}</p>
                                          ) : (
                                            <p>{currentWord} @ {currentCode} (权重: {(() => {
                                              // Extract suggested weight from impact message
                                              const match = meta.conflict.impact?.match(/权重: (\d+)/)
                                              if (match) return match[1]
                                              // Fallback: calculate based on current phrase weight
                                              return meta.conflict.currentPhrase!.weight + 1
                                            })()})</p>
                                          )}
                                        </div>
                                        {meta.conflict.suggestions.length > 0 && (
                                          <div className="mt-2 space-y-1">
                                            <p className="text-small font-medium">建议:</p>
                                            {meta.conflict.suggestions.map((sug, idx) => (
                                              <div key={idx} className="p-2 bg-primary-50 dark:bg-primary-100/10 rounded text-small flex justify-between items-start">
                                                <div className="flex-1">
                                                  <p className="text-default-600 dark:text-default-400">{sug.reason}</p>
                                                  {sug.toCode && <p className="text-primary">建议编码: {sug.toCode}</p>}
                                                </div>
                                                {sug.toCode && sug.action === 'Adjust' && (
                                                  <Button size="sm" variant="flat" color="primary" onPress={() => applySuggestion(index, sug)}>
                                                    应用
                                                  </Button>
                                                )}
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    )
                                  })()
                                )
                              ) : (
                                <div>
                                  <div className="flex items-center gap-2 mb-2">
                                    <Chip color="success" variant="flat" size="sm" startContent={<Check className="w-3 h-3" />}>
                                      无冲突
                                    </Chip>
                                  </div>
                                  {meta.conflict.impact && (
                                    <div className="flex items-center gap-1 text-small text-success-600 dark:text-success-400">
                                      <Lightbulb className="w-3 h-3" />
                                      <span>{meta.conflict.impact}</span>
                                    </div>
                                  )}
                                  {meta.conflict.suggestions.length > 0 && (
                                    <div className="mt-2 space-y-1">
                                      {meta.conflict.suggestions.map((sug, idx) => (
                                        <div key={idx} className="p-2 bg-success-50 dark:bg-success-100/10 rounded text-small">
                                          <p className="font-medium text-success-700 dark:text-success-400 flex items-center gap-1">
                                            {sug.action === 'Resolved' && <Check className="w-3 h-3" />}
                                            {sug.action === 'Resolved' ? '已解决' : sug.action}
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
                  )
                })}
              </ModalBody>
              <ModalFooter className="flex-col gap-2">
                <div className="flex gap-2 w-full items-center">
                  <Button
                    color="secondary"
                    variant="flat"
                    onPress={handleCheckAllConflicts}
                    isLoading={checkingAll}
                    className="flex-1"
                    startContent={!checkingAll && <Search className="w-4 h-4" />}
                  >
                    检测所有冲突
                  </Button>
                  {conflictStats.hasChecked && (
                    <>
                      {conflictStats.warningCount > 0 && (
                        <Chip color="warning" variant="flat" size="sm">
                          {conflictStats.warningCount} 个警告
                        </Chip>
                      )}
                      {conflictStats.conflictCount === 0 ? (
                        <Chip color="success" variant="flat" size="sm" startContent={<Check className="w-3 h-3" />}>
                          无冲突
                        </Chip>
                      ) : (
                        <Chip color="danger" variant="flat" size="sm">
                          {conflictStats.conflictCount} 个冲突
                        </Chip>
                      )}
                      {(conflictStats.conflictCount > 0 || conflictStats.warningCount > 0) && (
                        <div className="flex gap-1 items-center">
                          <Button
                            isIconOnly
                            size="sm"
                            variant="flat"
                            onPress={() => navigateToIssue('prev')}
                            title="上一个问题"
                          >
                            <ChevronUp size={16} />
                          </Button>
                          {currentIssuePosition && (
                            <span className="text-xs text-default-500 px-1 min-w-10 text-center">
                              {currentIssuePosition.current}/{currentIssuePosition.total}
                            </span>
                          )}
                          <Button
                            isIconOnly
                            size="sm"
                            variant="flat"
                            onPress={() => navigateToIssue('next')}
                            title="下一个问题"
                          >
                            <ChevronDown size={16} />
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </div>
                <div className="flex justify-between gap-2 w-full">
                  {!isEditMode && (
                    <div className="flex gap-2">
                      <Button
                        color="primary"
                        variant="bordered"
                        onPress={handleAddItem}
                        startContent={<Plus size={16} />}
                      >
                        添加
                      </Button>
                      <Button
                        color="secondary"
                        variant="bordered"
                        onPress={() => setShowDictParser(true)}
                        startContent={<FileText size={16} />}
                      >
                        词典解析
                      </Button>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Button variant="light" onPress={handleClose}>
                      取消
                    </Button>
                    <Tooltip
                      content="请先检测并解决冲突"
                      isDisabled={!fields.some((field) => {
                        const meta = getMeta(field.id)
                        const isResolved = meta.conflict?.suggestions?.some(sug => sug.action === 'Resolved')
                        return !meta.hasChecked || (meta.conflict?.hasConflict && !isResolved)
                      })}
                      color="warning"
                    >
                      <div>
                        <Button
                          color="primary"
                          onPress={() => onSubmitForm()}
                          isLoading={submitting}
                          isDisabled={fields.some((field) => {
                            const meta = getMeta(field.id)
                            const isResolved = meta.conflict?.suggestions?.some(sug => sug.action === 'Resolved')
                            return !meta.hasChecked || (meta.conflict?.hasConflict && !isResolved)
                          })}
                          className="w-full"
                        >
                          {isBatchEditMode ? '保存修改' : isEditMode ? '保存' : `批量创建 (${fields.length}个)`}
                        </Button>
                      </div>
                    </Tooltip>
                  </div>
                </div>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* Dictionary Parser Modal */}
      <Modal
        isOpen={showDictParser}
        onClose={() => {
          setShowDictParser(false)
          setDictInput('')
        }}
        size="2xl"
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>Rime词典解析</ModalHeader>
              <ModalBody>
                <div className="space-y-3">
                  <div>
                    <p className="text-sm text-default-600 mb-2">
                      请粘贴Rime词典格式的内容，每行格式：<code className="bg-content2 px-1 rounded">词条[Tab]编码</code>
                    </p>
                    <Textarea
                      placeholder={"示例：\n程序员\tjxyu\nalgorithm\tstfs\n的\td"}
                      value={dictInput}
                      onValueChange={setDictInput}
                      minRows={10}
                      className="font-mono text-sm"
                    />
                  </div>
                  <div className="bg-default-100 p-3 rounded-lg text-sm space-y-1">
                    <p className="font-semibold text-default-700">自动识别规则：</p>
                    <p className="text-default-600">• <span className="font-medium">纯英文</span> → 英文类型</p>
                    <p className="text-default-600">• <span className="font-medium">单个字符</span> → 单字类型</p>
                    <p className="text-default-600">• <span className="font-medium">其他</span> → 词组类型</p>
                  </div>
                </div>
              </ModalBody>
              <ModalFooter>
                <Button variant="light" onPress={onClose}>
                  取消
                </Button>
                <Button
                  color="primary"
                  onPress={handleParseDictionary}
                  isDisabled={!dictInput.trim()}
                >
                  解析并导入
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </>
  )
}
