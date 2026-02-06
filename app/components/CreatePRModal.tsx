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
  onSuccess: () => void | Promise<void>
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

  const { fields, append, remove } = useFieldArray({
    control,
    name: 'items'
  })

  // Meta states (conflict detection, checking status)
  const [metaStates, setMetaStates] = useState<Map<string, MetaState>>(new Map())
  const [submitting, setSubmitting] = useState(false)
  const [checkingAll, setCheckingAll] = useState(false)

  // Track if we've initialized the form in this modal session
  const hasInitializedRef = useRef(false)

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

  // Calculate conflict statistics
  const conflictStats = useMemo(() => {
    const checkedCount = fields.filter(field => {
      const meta = metaStates.get(field.id)
      return meta?.hasChecked
    }).length

    if (checkedCount === 0) {
      return { hasChecked: false, conflictCount: 0 }
    }

    const conflictCount = fields.filter(field => {
      const meta = metaStates.get(field.id)
      if (!meta?.hasChecked) return false
      const isResolved = meta.conflict?.suggestions?.some(sug => sug.action === 'Resolved')
      return meta.conflict?.hasConflict && !isResolved
    }).length

    return { hasChecked: true, conflictCount }
  }, [fields, metaStates])

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

  // Check all conflicts
  const handleCheckAllConflicts = async () => {
    const formData = getValues()

    // Trigger validation
    const isFormValid = await trigger()
    if (!isFormValid) {
      openAlert('请先修正表单错误', '验证失败')
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
    } catch (err) {
      const error = err as Error
      openAlert(error.message || '检测失败', '检测失败')
    } finally {
      setCheckingAll(false)
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

      // Check for duplicate code (重码) in Create action
      if (item.action === 'Create' && meta.conflict?.currentPhrase && !isResolved) {
        // Extract suggested weight from impact message
        const match = meta.conflict.impact?.match(/权重: (\d+)/);
        const actualWeight = match ? match[1] : (meta.conflict.currentPhrase.weight + 1).toString();

        itemsNeedingConfirmation.push(
          `📍 项目 #${i + 1} - 创建重码警告:\n` +
          `   编码: ${item.code}\n` +
          `   现有词条: ${meta.conflict.currentPhrase.word} (权重: ${meta.conflict.currentPhrase.weight})\n` +
          `   新增词条: ${item.word} (权重: ${actualWeight})\n` +
          `   ⚠️ 这将创建重码（同一编码对应多个词条）！`
        )
      }

      // Check for Change action - warn about removal
      if (item.action === 'Change' && item.oldWord) {
        itemsNeedingConfirmation.push(
          `📍 项目 #${i + 1} - 修改操作警告:\n` +
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
              remark: item.remark || undefined
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
            remark: item.remark || undefined
          },
          withAuth: true
        })
      } else {
        // Create multiple PRs
        for (const item of data.items) {
          await apiRequest('/api/pull-requests', {
            method: 'POST',
            body: {
              action: item.action,
              word: item.word,
              oldWord: item.action === 'Change' ? item.oldWord : undefined,
              code: item.code,
              type: item.action !== 'Delete' ? item.type : undefined,
              weight: item.weight ? parseInt(item.weight) : (item.action !== 'Delete' ? getDefaultWeight(item.type as PhraseType) : undefined),
              remark: item.remark || undefined,
              batchId
            },
            withAuth: true
          })
        }
      }

      // Success! Show message and close
      openAlert(
        isBatchEditMode ? '批量更新成功' : isEditMode ? '更新成功' : `成功创建 ${data.items.length} 个修改提议`,
        '操作成功'
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
                    <Card key={field.id} className="border-2 min-h-100 shrink-0">
                      <CardHeader className="flex justify-between">
                        <span className="font-semibold">修改 #{index + 1}</span>
                        {!isEditMode && fields.length > 1 && (
                          <Button
                            size="sm"
                            color="danger"
                            variant="light"
                            onPress={() => handleRemoveItem(index)}
                          >
                            删除
                          </Button>
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
                              onValueChange={(value) => {
                                actionField.onChange(value)
                                // Reset check state when action changes
                                updateMeta(field.id, { hasChecked: false, conflict: null })
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
                                          />
                                        )}
                                      />
                                      <Controller
                                        name={`items.${index}.code`}
                                        control={control}
                                        rules={{
                                          required: '编码不能为空',
                                          pattern: {
                                            value: /^[a-zA-Z]+$/,
                                            message: '编码只能包含字母'
                                          }
                                        }}
                                        render={({ field: codeField, fieldState }) => (
                                          <Input
                                            value={codeField.value}
                                            label="编码"
                                            placeholder="请输入编码（仅字母）"
                                            isRequired
                                            isInvalid={!!fieldState.error}
                                            errorMessage={fieldState.error?.message}
                                            color={fieldState.error ? 'danger' : 'default'}
                                            className="flex-1"
                                            onValueChange={(v) => {
                                              codeField.onChange(v)
                                              updateMeta(field.id, { hasChecked: false, conflict: null })
                                            }}
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
                                        />
                                      )}
                                    />
                                    <Controller
                                      name={`items.${index}.code`}
                                      control={control}
                                      rules={{
                                        required: '编码不能为空',
                                        pattern: {
                                          value: /^[a-zA-Z]+$/,
                                          message: '编码只能包含字母'
                                        }
                                      }}
                                      render={({ field: codeField, fieldState }) => (
                                        <Input
                                          value={codeField.value}
                                          label="编码"
                                          placeholder="请输入编码（仅字母）"
                                          isRequired
                                          isInvalid={!!fieldState.error}
                                          errorMessage={fieldState.error?.message}
                                          color={fieldState.error ? 'danger' : 'default'}
                                          className="flex-1"
                                          onValueChange={(v) => {
                                            codeField.onChange(v)
                                            updateMeta(field.id, { hasChecked: false, conflict: null })
                                          }}
                                        />
                                      )}
                                    />
                                  </div>
                                )}

                                {currentAction !== 'Delete' && (
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
                                  <Chip color="danger" variant="flat" size="sm" className="mb-2">
                                    ⚠️ 冲突
                                  </Chip>
                                  <p className="text-small mb-2">{meta.conflict.impact}</p>
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
                                      <Chip color="success" variant="flat" size="sm">✓ 已解决</Chip>
                                    </div>
                                    {meta.conflict.impact && (
                                      <p className="text-small text-success-600 dark:text-success-400 mb-2">
                                        💡 {meta.conflict.impact}
                                      </p>
                                    )}
                                    {meta.conflict.suggestions.length > 0 && (
                                      <div className="mt-2 space-y-1">
                                        {meta.conflict.suggestions.map((sug, idx) => (
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
                                      {meta.conflict.impact || '此编码已存在其他词条，将创建重码'}
                                    </p>
                                    <div className="mb-2 p-2 bg-warning-50 dark:bg-warning-100/10 rounded text-small">
                                      <p className="font-medium text-warning-700 dark:text-warning-400">现有词条:</p>
                                      <p>{meta.conflict.currentPhrase!.word} @ {meta.conflict.currentPhrase!.code} (权重: {meta.conflict.currentPhrase!.weight})</p>
                                    </div>
                                    <div className="p-2 bg-warning-50 dark:bg-warning-100/10 rounded text-small">
                                      <p className="font-medium text-warning-700 dark:text-warning-400">即将创建:</p>
                                      <p>{watch(`items.${index}.word`)} @ {watch(`items.${index}.code`)} (权重: {(() => {
                                        // Extract suggested weight from impact message
                                        const match = meta.conflict.impact?.match(/权重: (\d+)/);
                                        if (match) return match[1];
                                        // Fallback: calculate based on current phrase weight
                                        return meta.conflict.currentPhrase!.weight + 1;
                                      })()})</p>
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
                              ) : (
                                <div>
                                  <div className="flex items-center gap-2 mb-2">
                                    <Chip color="success" variant="flat" size="sm">✓</Chip>
                                    <span className="text-small">无冲突</span>
                                  </div>
                                  {meta.conflict.impact && (
                                    <p className="text-small text-success-600 dark:text-success-400">
                                      💡 {meta.conflict.impact}
                                    </p>
                                  )}
                                  {meta.conflict.suggestions.length > 0 && (
                                    <div className="mt-2 space-y-1">
                                      {meta.conflict.suggestions.map((sug, idx) => (
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
                  >
                    🔍 检测所有冲突
                  </Button>
                  {conflictStats.hasChecked && (
                    conflictStats.conflictCount === 0 ? (
                      <Chip color="success" variant="flat" size="sm">
                        ✓ 无冲突
                      </Chip>
                    ) : (
                      <Chip color="danger" variant="flat" size="sm">
                        {conflictStats.conflictCount} 个冲突
                      </Chip>
                    )
                  )}
                </div>
                <div className="flex gap-2 w-full">
                  {!isEditMode && (
                    <Button
                      color="primary"
                      variant="bordered"
                      onPress={handleAddItem}
                    >
                      + 添加
                    </Button>
                  )}
                  <Button variant="light" onPress={handleClose} className="flex-1">
                    取消
                  </Button>
                  <Button
                    color="primary"
                    onPress={() => onSubmitForm()}
                    isLoading={submitting}
                    isDisabled={fields.some((field) => {
                      const meta = getMeta(field.id)
                      const isResolved = meta.conflict?.suggestions?.some(sug => sug.action === 'Resolved')
                      return !meta.hasChecked || (meta.conflict?.hasConflict && !isResolved)
                    })}
                    className="flex-1"
                  >
                    {isBatchEditMode ? '保存修改' : isEditMode ? '保存' : `批量创建 (${fields.length}个)`}
                  </Button>
                </div>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

    </>
  )
}
