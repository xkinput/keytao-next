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
import type { BatchPRItem } from '@/lib/services/batchConflictService'
import { buildBatchSubmitWarnings, formatBatchSubmitWarnings, type BatchSubmitWarning } from '@/lib/services/batchSubmitWarnings'
import { Trash2, FileText, CornerUpLeft, CornerDownLeft, ChevronUp, ChevronDown, Plus, Edit2, AlertTriangle, Eye, Check, Search, WandSparkles } from 'lucide-react'
import CodePhrasesPopover from './CodePhrasesPopover'
import WordCodesPopover from './WordCodesPopover'
import type { InferResponse } from '@/app/api/phrases/infer/route'
import type { ContextResponse } from '@/app/api/phrases/context/route'

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

interface BatchConflictCheckResponse {
  results: Array<{ id: string; conflict: ConflictInfo }>
  warnings: BatchSubmitWarning[]
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

interface DictParseItem {
  key: string
  word: string
  inputCode?: string
  finalCode: string
  type: string
  weight: string
  /** code slot result */
  status: 'inferring' | 'new' | 'shifted' | 'overflow' | 'error'
  statusDetail?: string
  excluded: boolean
  infer?: InferResponse
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
  const watchedItems = watch('items')

  const buildBatchCheckItems = (items: FormItem[]): BatchPRItem[] => items.map((item, index) => ({
    id: fields[index]?.id ?? String(index),
    action: item.action,
    word: item.word,
    oldWord: item.action === 'Change' ? item.oldWord || undefined : undefined,
    code: item.code,
    weight: item.weight ? parseInt(item.weight) : undefined,
    type: item.type as PhraseType,
  }))

  // Meta states (conflict detection, checking status)
  const [metaStates, setMetaStates] = useState<Map<string, MetaState>>(new Map())
  const [submitting, setSubmitting] = useState(false)
  const [checkingAll, setCheckingAll] = useState(false)
  const [showDictParser, setShowDictParser] = useState(false)
  const [dictInput, setDictInput] = useState('')
  const [dictStep, setDictStep] = useState<'input' | 'preview'>('input')
  const [dictItems, setDictItems] = useState<DictParseItem[]>([])
  const [dictInferring, setDictInferring] = useState(false)
  // Which item is currently in edit/expand mode; null = all collapsed
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null)

  // Track if we've initialized the form in this modal session
  const hasInitializedRef = useRef(false)

  // Track which fields had their code auto-filled (so user edits override auto-fill)
  const autoFilledRef = useRef<Set<string>>(new Set())
  // Track encoding loading state per field
  const [encodingFields, setEncodingFields] = useState<Set<string>>(new Set())
  // Per-field infer result (code slot info + word duplicate info)
  const [inferResults, setInferResults] = useState<Map<string, InferResponse>>(new Map())
  const [contextResults, setContextResults] = useState<Map<string, ContextResponse>>(new Map())

  const setInferResult = (fieldId: string, result: InferResponse | null) => {
    setInferResults(prev => {
      const next = new Map(prev)
      if (result === null) next.delete(fieldId)
      else next.set(fieldId, result)
      return next
    })
  }

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

  const checkedSubmitWarningIds = (() => {
    const entries = fields
      .map((field, index) => ({ field, index, item: watchedItems[index], meta: metaStates.get(field.id) }))
      .filter((entry): entry is {
        field: typeof fields[number]
        index: number
        item: FormItem
        meta: MetaState & { conflict: ConflictInfo }
      } => Boolean(entry.item && entry.meta?.hasChecked && entry.meta.conflict))

    const items = entries.map(entry => buildBatchCheckItems([entry.item]).map(item => ({ ...item, id: entry.field.id }))[0])
    const results = entries.map(entry => ({ id: entry.field.id, conflict: entry.meta.conflict }))

    return new Set(buildBatchSubmitWarnings(items, results).map(warning => warning.id))
  })()

  // Calculate conflict and warning statistics
  const conflictStats = (() => {
    const checkedCount = fields.filter(field => {
      const meta = metaStates.get(field.id)
      return meta?.hasChecked
    }).length

    if (checkedCount === 0) {
      return { hasChecked: false, conflictCount: 0, warningCount: 0 }
    }

    let conflictCount = 0
    let warningCount = 0

    fields.forEach((field) => {
      const meta = metaStates.get(field.id)
      if (!meta?.hasChecked) return

      const isResolved = meta.conflict?.suggestions?.some(sug => sug.action === 'Resolved')

      // Conflict: has conflict and not resolved
      if (meta.conflict?.hasConflict && !isResolved) {
        conflictCount++
      }
      else if (checkedSubmitWarningIds.has(field.id)) {
        warningCount++
      }
    })

    return { hasChecked: true, conflictCount, warningCount }
  })()

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
      setExpandedIndex(0)
    } else if (!isOpen) {
      // Modal closed - reset the initialization flag for next open
      hasInitializedRef.current = false
    }
  }, [isOpen, batchPRs, editPR, reset, defaultFormItem])

  // Auto-infer: watch word changes, debounce 600ms, fill code with first available slot
  // Also checks if word already exists in DB (single round-trip via /api/phrases/infer)
  useEffect(() => {
    const timers = new Map<string, ReturnType<typeof setTimeout>>()

    const subscription = watch((values, { name }) => {
      if (!name?.includes('.word')) return
      const indexMatch = name.match(/items\.(\d+)\.word/)
      if (!indexMatch) return

      const index = parseInt(indexMatch[1])
      const item = values.items?.[index]
      if (!item) return

      const word = (item.word ?? '').trim()
      const code = item.code ?? ''
      const action = item.action
      const fieldId = fields[index]?.id

      if (!fieldId) return

      // Clear infer result when word is cleared
      if (!word) {
        setInferResult(fieldId, null)
        return
      }

      if (action === 'Delete') return
      // Only auto-fill code if it's empty or was previously auto-filled
      const shouldFillCode = !code || autoFilledRef.current.has(fieldId)

      // Debounce per field
      const existing = timers.get(fieldId)
      if (existing) clearTimeout(existing)

      if (shouldFillCode) setEncodingFields(prev => new Set(prev).add(fieldId))

      const timer = setTimeout(async () => {
        timers.delete(fieldId)
        try {
          const params = new URLSearchParams({ word, ...(code.trim() ? { code: code.trim() } : {}) })
          const res = await fetch(`/api/phrases/infer?${params}`)
          if (!res.ok) return
          const data: InferResponse = await res.json()

          setInferResult(fieldId, data)

          if (shouldFillCode && data.suggestion) {
            setValue(`items.${index}.code`, data.suggestion, { shouldValidate: true })
            autoFilledRef.current.add(fieldId)
          }
        } catch {
          // silently ignore
        } finally {
          setEncodingFields(prev => { const s = new Set(prev); s.delete(fieldId); return s })
        }
      }, 600)

      timers.set(fieldId, timer)
    })

    return () => {
      subscription.unsubscribe()
      timers.forEach(t => clearTimeout(t))
    }
  }, [watch, fields, setValue])

  // Context fetch: watch code changes, show surrounding phrases in collapsed diff rows
  useEffect(() => {
    const timers = new Map<string, ReturnType<typeof setTimeout>>()

    const subscription = watch((values, { name }) => {
      if (!name?.includes('.code')) return
      const indexMatch = name.match(/items\.(\d+)\.code/)
      if (!indexMatch) return
      const index = parseInt(indexMatch[1])
      const fieldId = fields[index]?.id
      if (!fieldId) return

      const code = (values.items?.[index]?.code ?? '').trim()
      const word = (values.items?.[index]?.word ?? '').trim()
      const action = values.items?.[index]?.action
      const type = (values.items?.[index]?.type ?? '').trim()
      if (!code) {
        setContextResults(prev => { const n = new Map(prev); n.delete(fieldId); return n })
        return
      }

      const existing = timers.get(fieldId)
      if (existing) clearTimeout(existing)

      const timer = setTimeout(async () => {
        try {
          if (word && action !== 'Delete') {
            const inferParams = new URLSearchParams({ word, code })
            const inferRes = await fetch(`/api/phrases/infer?${inferParams}`)
            if (inferRes.ok) {
              const inferData: InferResponse = await inferRes.json()
              setInferResult(fieldId, inferData)
            }
          }
          const params = new URLSearchParams({ code, count: '3', ...(type ? { type } : {}) })
          const res = await fetch(`/api/phrases/context?${params}`)
          if (res.ok) {
            const data: ContextResponse = await res.json()
            setContextResults(prev => new Map(prev).set(fieldId, data))
          }
        } catch { /* ignore */ }
      }, 600)

      timers.set(fieldId, timer)
    })

    return () => {
      subscription.unsubscribe()
      timers.forEach(t => clearTimeout(t))
    }
  }, [watch, fields])

  // Fetch context for all pre-filled codes on mount / when fields change
  useEffect(() => {
    const values = getValues('items')
    fields.forEach((field, index) => {
      const code = (values[index]?.code ?? '').trim()
      const type = (values[index]?.type ?? '').trim()
      if (!code) return
      const params = new URLSearchParams({ code, count: '3', ...(type ? { type } : {}) })
      fetch(`/api/phrases/context?${params}`)
        .then(r => r.ok ? r.json() : null)
        .then((data: ContextResponse | null) => {
          if (data) setContextResults(prev => new Map(prev).set(field.id, data))
        })
        .catch(() => { /* ignore */ })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields.map(f => f.id).join(',')])

  // Add new item
  const handleAddItem = () => {
    const newIndex = fields.length
    append(defaultFormItem)
    setTimeout(() => {
      const newField = fields[newIndex]
      if (newField) {
        updateMeta(newField.id, { conflict: null, hasChecked: false, checking: false })
      }
      setExpandedIndex(newIndex)
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
        updateMeta(newField.id, { conflict: null, hasChecked: false, checking: false })
      }
      setExpandedIndex(index)
    }, 0)
  }

  // Add item below
  const handleAddItemBelow = (index: number) => {
    insert(index + 1, defaultFormItem)
    setTimeout(() => {
      const newField = fields[index + 1]
      if (newField) {
        updateMeta(newField.id, { conflict: null, hasChecked: false, checking: false })
      }
      setExpandedIndex(index + 1)
    }, 0)
  }

  // Dict parser helpers
  const closeDictParser = () => {
    setShowDictParser(false)
    setDictInput('')
    setDictStep('input')
    setDictItems([])
  }

  const handleDictPreview = async () => {
    if (!dictInput.trim()) {
      openAlert('请输入词典内容', '输入为空')
      return
    }

    const lines = dictInput.split('\n').filter(line => line.trim())
    const parsed: DictParseItem[] = []
    for (const line of lines) {
      const parts = line.split(/\t| {2,}| /)
      const word = parts[0].trim()
      if (!word) continue
      const inputCode = parts[1]?.trim() || undefined
      const type = detectPhraseType(word, inputCode || '')
      const weight = getDefaultWeight(type)
      parsed.push({
        key: `dict-${Math.random().toString(36).slice(2, 9)}`,
        word,
        inputCode,
        finalCode: inputCode || '',
        type,
        weight: weight.toString(),
        status: 'inferring',
        excluded: false,
      })
    }

    if (parsed.length === 0) {
      openAlert('未能解析到有效词条，请检查格式', '解析失败')
      return
    }
    if (parsed.length > 200) {
      openAlert('单次最多 200 个词条，请分批导入', '词条过多')
      return
    }

    setDictItems(parsed)
    setDictStep('preview')
    setDictInferring(true)

    try {
      const res = await fetch('/api/phrases/infer-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ words: parsed.map(p => p.word) }),
      })
      if (!res.ok) throw new Error('批量推断失败')
      const data = await res.json() as { results: InferResponse[] }

      setDictItems(prev => prev.map((item, idx) => {
        const infer = data.results[idx]
        if (!infer) return { ...item, status: 'error' as const }

        let finalCode = item.inputCode || ''
        let status: DictParseItem['status'] = 'new'
        let statusDetail: string | undefined

        if (!item.inputCode) {
          if (infer.suggestion === null) {
            // All progressive + alt slots taken — add as 重码 using longest code
            finalCode = infer.codes.at(-1) ?? infer.codes[0] ?? ''
            status = 'overflow'
          } else if (infer.isBaseConflict) {
            finalCode = infer.suggestion
            status = 'shifted'
            statusDetail = `${infer.codes[0]} → ${infer.suggestion}`
          } else {
            finalCode = infer.suggestion
            status = 'new'
          }
        }

        if (infer.wordExists.length > 0) {
          const existCodes = infer.wordExists.map(e => e.code).join('、')
          const note = `词已存在：${existCodes}`
          statusDetail = statusDetail ? `${statusDetail}；${note}` : note
        }

        return { ...item, infer, finalCode, status, statusDetail }
      }))
    } catch (err) {
      setDictItems(prev => prev.map(item => ({
        ...item, status: 'error' as const,
        statusDetail: (err as Error).message,
      })))
      openAlert((err as Error).message || '批量推断失败', '推断出错')
    } finally {
      setDictInferring(false)
    }
  }

  const handleDictConfirm = () => {
    const toAdd = dictItems.filter(item => !item.excluded && item.finalCode.trim())
    toAdd.forEach(item => {
      append({
        action: 'Create',
        word: item.word,
        oldWord: '',
        code: item.finalCode,
        type: item.type,
        weight: item.weight,
        remark: '',
      })
    })
    closeDictParser()
    toast.success(`已添加 ${toAdd.length} 个词条`)
  }

  const updateDictItemCode = (idx: number, code: string) => {
    setDictItems(prev => prev.map((item, i) => i === idx ? { ...item, finalCode: code } : item))
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
          items: buildBatchCheckItems(formData.items)
        },
        withAuth: true
      }) as BatchConflictCheckResponse

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
        const warningIds = new Set(result.warnings.map(warning => warning.id))
        const firstConflictIndex = result.results.findIndex(({ id, conflict }) => {
          const isResolved = conflict.suggestions?.some(sug => sug.action === 'Resolved')
          return (conflict.hasConflict && !isResolved) || warningIds.has(id)
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
      }) as BatchConflictCheckResponse

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
    const items = buildBatchCheckItems(data.items)
    let checkResult: BatchConflictCheckResponse

    try {
      checkResult = await apiRequest('/api/pull-requests/check-conflicts-batch', {
        method: 'POST',
        body: { items },
        withAuth: true
      }) as BatchConflictCheckResponse
    } catch (err) {
      const error = err as Error
      const message = error.message ? `${error.message}\n请重试` : '检测失败，请重试'
      openAlert(message, '检测失败')
      return
    }

    checkResult.results.forEach(({ id, conflict }) => {
      updateMeta(id, {
        conflict,
        hasChecked: true,
        checking: false,
      })
    })

    for (let i = 0; i < checkResult.results.length; i++) {
      const { conflict } = checkResult.results[i]
      const isResolved = conflict.suggestions?.some((sug) => sug.action === 'Resolved')
      if (conflict.hasConflict && !isResolved) {
        openAlert(`存在冲突，请解决后再提交（项目 #${i + 1}）`, '存在冲突')
        return
      }
    }

    // Collect items that need confirmation
    const itemsNeedingConfirmation: string[] = formatBatchSubmitWarnings(checkResult.warnings, items)

    for (let i = 0; i < fields.length; i++) {
      const item = data.items[i]

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

  const applyFlyKeyCode = (fieldIndex: number, fieldId: string, code: string) => {
    setValue(`items.${fieldIndex}.code`, code, { shouldDirty: true, shouldValidate: true })
    autoFilledRef.current.delete(fieldId)
    updateMeta(fieldId, { hasChecked: false, conflict: null })
  }

  // Navigate to next/previous conflict or warning
  const navigateToIssue = (direction: 'next' | 'prev') => {
    const issueIndices: number[] = []

    fields.forEach((field, index) => {
      const meta = metaStates.get(field.id)
      if (!meta?.hasChecked) return

      const isResolved = meta.conflict?.suggestions?.some(sug => sug.action === 'Resolved')

      // Has conflict or warning
      const hasIssue =
        (meta.conflict?.hasConflict && !isResolved) ||
        checkedSubmitWarningIds.has(field.id)

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

      const hasIssue =
        (meta.conflict?.hasConflict && !isResolved) ||
        checkedSubmitWarningIds.has(field.id)

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
  }, [currentIssueIndex, fields, metaStates, checkedSubmitWarningIds])


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
              <ModalBody className="gap-1.5 overflow-y-auto py-3 pb-0">
                {fields.map((field, index) => {
                  const meta = getMeta(field.id)
                  const isExpanded = expandedIndex === index
                  const currentAction = watch(`items.${index}.action`)
                  const currentWord = watch(`items.${index}.word`)
                  const currentOldWord = watch(`items.${index}.oldWord`)
                  const currentCode = watch(`items.${index}.code`)
                  const currentType = watch(`items.${index}.type`) as PhraseType
                  const currentWeight = watch(`items.${index}.weight`) || String(getDefaultWeight(currentType))
                  const infer = inferResults.get(field.id)
                  const isResolved = meta.conflict?.suggestions?.some(s => s.action === 'Resolved')
                  const hasConflict = !!(meta.conflict?.hasConflict && !isResolved)
                  const hasWarning = checkedSubmitWarningIds.has(field.id)
                  const isIncomplete = !currentWord || !currentCode
                  const context = contextResults.get(field.id)

                  return (
                    <div
                      key={field.id}
                      ref={(el: HTMLDivElement | null) => {
                        if (el) cardRefs.current.set(field.id, el)
                        else cardRefs.current.delete(field.id)
                      }}
                    >
                      {isExpanded ? (
                        /* ── EDIT MODE ──────────────────────────── */
                        <div className={`rounded-xl border-2 overflow-hidden transition-colors ${currentAction === 'Delete' ? 'border-danger/40' :
                          currentAction === 'Change' ? 'border-warning/40' : 'border-success/40'
                          }`}>
                          {/* Context before */}
                          {context?.before && context.before.length > 0 && context.before.map((p, i) => (
                            <div key={i} className="flex items-center gap-2 px-3 py-0.5 font-mono text-xs text-default-500 dark:text-default-400 bg-default-100 dark:bg-default-50/30">
                              <span className="w-4 shrink-0 text-center text-default-300"> </span>
                              <span className="shrink-0">{p.word}</span>
                              <span className="shrink-0">{p.code}</span><span className="shrink-0 text-default-300">{p.weight}</span>

                            </div>
                          ))}
                          <div className="p-3 flex flex-col gap-2.5">
                            {/* Row 1: index + action pills + confirm/delete */}
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs text-default-400 shrink-0 w-5 text-center">#{index + 1}</span>
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
                                    classNames={{ wrapper: "gap-1.5" }}
                                    onValueChange={async (value) => {
                                      actionField.onChange(value)
                                      updateMeta(field.id, { hasChecked: false, conflict: null })
                                      const currentData = getValues(`items.${index}`)
                                      if (value === 'Change' && currentData.code) {
                                        if (!currentData.oldWord) {
                                          try {
                                            const response = await fetch(`/api/phrases/by-code?code=${encodeURIComponent(currentData.code)}&page=1`)
                                            if (response.ok) {
                                              const data = await response.json()
                                              if (data.phrases?.length > 0) {
                                                const firstPhrase = data.phrases.find((p: { code: string; word: string }) => p.code === currentData.code)
                                                if (firstPhrase) setValue(`items.${index}.oldWord`, firstPhrase.word)
                                              }
                                            }
                                          } catch (err) {
                                            console.error('Failed to fetch phrase by code:', err)
                                          }
                                        }
                                        setTimeout(async () => {
                                          const updatedData = getValues(`items.${index}`)
                                          updateMeta(field.id, { checking: true })
                                          try {
                                            const result = await apiRequest('/api/pull-requests/check-conflicts-batch', {
                                              method: 'POST',
                                              body: { items: [{ id: field.id, action: 'Change', word: updatedData.word, oldWord: updatedData.oldWord || '', code: updatedData.code, weight: updatedData.weight ? parseInt(updatedData.weight) : undefined, type: updatedData.type }] },
                                              withAuth: true
                                            }) as BatchConflictCheckResponse
                                            const conflictData = result.results[0]
                                            if (conflictData) updateMeta(field.id, { conflict: conflictData.conflict, hasChecked: true, checking: false })
                                          } catch { updateMeta(field.id, { checking: false }) }
                                        }, 100)
                                      }
                                      if ((value === 'Create' || value === 'Delete') && currentData.word && currentData.code) {
                                        updateMeta(field.id, { checking: true })
                                        try {
                                          const result = await apiRequest('/api/pull-requests/check-conflicts-batch', {
                                            method: 'POST',
                                            body: { items: [{ id: field.id, action: value, word: currentData.word, oldWord: undefined, code: currentData.code, weight: currentData.weight ? parseInt(currentData.weight) : undefined, type: currentData.type }] },
                                            withAuth: true
                                          }) as BatchConflictCheckResponse
                                          const conflictData = result.results[0]
                                          if (conflictData) updateMeta(field.id, { conflict: conflictData.conflict, hasChecked: true, checking: false })
                                        } catch { updateMeta(field.id, { checking: false }) }
                                      }
                                    }}
                                  >
                                    <Radio value="Create" color="success" classNames={{ base: "m-0 bg-content1 hover:bg-success-50 dark:hover:bg-success-50/10 cursor-pointer rounded-lg px-2.5 py-1 border-2 border-transparent data-[selected=true]:border-success data-[selected=true]:bg-success-50 dark:data-[selected=true]:bg-success-50/10" }}>
                                      <span className="flex items-center gap-1 text-small font-semibold"><Plus className="w-3 h-3 text-success" />新增</span>
                                    </Radio>
                                    <Radio value="Change" color="warning" classNames={{ base: "m-0 bg-content1 hover:bg-warning-50 dark:hover:bg-warning-50/10 cursor-pointer rounded-lg px-2.5 py-1 border-2 border-transparent data-[selected=true]:border-warning data-[selected=true]:bg-warning-50 dark:data-[selected=true]:bg-warning-50/10" }}>
                                      <span className="flex items-center gap-1 text-small font-semibold"><Edit2 className="w-3 h-3 text-warning" />修改</span>
                                    </Radio>
                                    <Radio value="Delete" color="danger" classNames={{ base: "m-0 bg-content1 hover:bg-danger-50 dark:hover:bg-danger-50/10 cursor-pointer rounded-lg px-2.5 py-1 border-2 border-transparent data-[selected=true]:border-danger data-[selected=true]:bg-danger-50 dark:data-[selected=true]:bg-danger-50/10" }}>
                                      <span className="flex items-center gap-1 text-small font-semibold"><Trash2 className="w-3 h-3 text-danger" />删除</span>
                                    </Radio>
                                  </RadioGroup>
                                )}
                              />
                              <div className="ml-auto flex items-center gap-1">
                                {!isEditMode && (
                                  <>
                                    <Tooltip content="上方插入"><Button size="sm" variant="light" isIconOnly className="w-7 h-7 min-w-0" onPress={() => handleAddItemAbove(index)}><CornerUpLeft className="w-3" /></Button></Tooltip>
                                    <Tooltip content="下方插入"><Button size="sm" variant="light" isIconOnly className="w-7 h-7 min-w-0" onPress={() => handleAddItemBelow(index)}><CornerDownLeft className="w-3" /></Button></Tooltip>
                                    {fields.length > 1 && (
                                      <Button size="sm" color="danger" variant="light" isIconOnly className="w-7 h-7 min-w-0" onPress={() => handleRemoveItem(index)}>
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </Button>
                                    )}
                                    <Button size="sm" color="primary" variant="flat" className="h-7 px-3 text-xs" onPress={() => setExpandedIndex(null)}>
                                      ✓ 确认
                                    </Button>
                                  </>
                                )}
                              </div>
                            </div>

                            {/* Fields */}
                            <Controller
                              name={`items.${index}.action`}
                              control={control}
                              render={({ field: watchField }) => {
                                const act = watchField.value
                                return (
                                  <>
                                    {act === 'Change' ? (
                                      <>
                                        <div className="flex flex-wrap gap-2">
                                          {/* Group 1: 类型 + 旧词 + 新词 */}
                                          <div className="flex gap-2 flex-1 min-w-52">
                                            <Controller
                                              name={`items.${index}.type`}
                                              control={control}
                                              render={({ field: f }) => (
                                                <Select label="类型" selectedKeys={[f.value]} onSelectionChange={keys => f.onChange(Array.from(keys)[0] as string)} disallowEmptySelection size="sm" className="w-24 shrink-0">
                                                  {getPhraseTypeOptions().map(o => <SelectItem key={o.value}>{o.label}</SelectItem>)}
                                                </Select>
                                              )}
                                            />
                                            <Controller
                                              name={`items.${index}.oldWord`}
                                              control={control}
                                              rules={{ required: '旧词不能为空' }}
                                              render={({ field: f, fieldState }) => (
                                                <Input
                                                  value={f.value} label="旧词" placeholder="当前编码对应的词"
                                                  isRequired isInvalid={!!fieldState.error} errorMessage={fieldState.error?.message}
                                                  size="sm" className="flex-1"
                                                  onValueChange={v => { f.onChange(v); updateMeta(field.id, { hasChecked: false, conflict: null }) }}
                                                  onBlur={() => autoCheckConflictForItem(index, field.id)}
                                                  endContent={f.value && <WordCodesPopover word={f.value}><Button size="sm" variant="light" isIconOnly className="min-w-unit-6 w-6 h-6"><Eye className="w-4 h-4" /></Button></WordCodesPopover>}
                                                />
                                              )}
                                            />
                                            <Controller
                                              name={`items.${index}.word`}
                                              control={control}
                                              rules={{ required: '新词不能为空' }}
                                              render={({ field: f, fieldState }) => {
                                                const inf = inferResults.get(field.id)
                                                return (
                                                  <Input
                                                    value={f.value} label="新词" placeholder="请输入新词"
                                                    isRequired isInvalid={!!fieldState.error} errorMessage={fieldState.error?.message}
                                                    size="sm" className="flex-1"
                                                    onValueChange={v => { f.onChange(v); updateMeta(field.id, { hasChecked: false, conflict: null }) }}
                                                    endContent={
                                                      <div className="flex items-center gap-1">
                                                        {inf && inf.wordExists.length > 0 && <Tooltip content={`词条已存在，编码：${inf.wordExists.map(e => e.code).join('、')}`}><Chip size="sm" variant="flat" color="warning" className="h-5 text-[10px] cursor-default">已存在</Chip></Tooltip>}
                                                        {f.value && <WordCodesPopover word={f.value}><Button size="sm" variant="light" isIconOnly className="min-w-unit-6 w-6 h-6"><Eye className="w-4 h-4" /></Button></WordCodesPopover>}
                                                      </div>
                                                    }
                                                  />
                                                )
                                              }}
                                            />
                                          </div>
                                          {/* Group 2: 编码 + 权重 */}
                                          <div className="flex gap-2">
                                            <Controller
                                              name={`items.${index}.code`}
                                              control={control}
                                              rules={{ required: '编码不能为空', pattern: { value: CODE_PATTERN, message: '编码格式错误' } }}
                                              render={({ field: f, fieldState }) => (
                                                <Input
                                                  value={f.value} label="编码" placeholder="请输入编码"
                                                  isRequired isInvalid={!!fieldState.error} errorMessage={fieldState.error?.message}
                                                  size="sm" className="flex-1"
                                                  onValueChange={v => { f.onChange(v); updateMeta(field.id, { hasChecked: false, conflict: null }) }}
                                                  onBlur={() => autoCheckConflictForItem(index, field.id)}
                                                  endContent={f.value && <CodePhrasesPopover code={f.value}><Button size="sm" variant="light" isIconOnly className="min-w-unit-6 w-6 h-6"><Eye className="w-4 h-4" /></Button></CodePhrasesPopover>}
                                                />
                                              )}
                                            />
                                            <Controller
                                              name={`items.${index}.weight`}
                                              control={control}
                                              render={({ field: f }) => {
                                                const t = watch(`items.${index}.type`) as PhraseType
                                                return <Input value={f.value} label="权重" type="number" placeholder={`${getDefaultWeight(t)}`} size="sm" className="w-16 shrink-0" onValueChange={v => f.onChange(v)} />
                                              }}
                                            />
                                          </div>
                                        </div>
                                      </>
                                    ) : act === 'Delete' ? (
                                      <div className="flex flex-wrap gap-2">
                                        <div className="flex gap-2 flex-1 min-w-44">
                                          <Controller
                                            name={`items.${index}.type`}
                                            control={control}
                                            render={({ field: f }) => (
                                              <Select label="类型" selectedKeys={[f.value]} onSelectionChange={keys => f.onChange(Array.from(keys)[0] as string)} disallowEmptySelection size="sm" className="w-24 shrink-0">
                                                {getPhraseTypeOptions().map(o => <SelectItem key={o.value}>{o.label}</SelectItem>)}
                                              </Select>
                                            )}
                                          />
                                          <Controller
                                            name={`items.${index}.word`}
                                            control={control}
                                            rules={{ required: '词不能为空' }}
                                            render={({ field: f, fieldState }) => (
                                              <Input
                                                value={f.value} label="词" placeholder="请输入词"
                                                isRequired isInvalid={!!fieldState.error} errorMessage={fieldState.error?.message}
                                                size="sm" className="flex-1"
                                                onValueChange={v => { f.onChange(v); updateMeta(field.id, { hasChecked: false, conflict: null }) }}
                                              />
                                            )}
                                          />
                                        </div>
                                        <Controller
                                          name={`items.${index}.code`}
                                          control={control}
                                          rules={{ required: '编码不能为空', pattern: { value: CODE_PATTERN, message: '编码格式错误' } }}
                                          render={({ field: f, fieldState }) => (
                                            <Input
                                              value={f.value} label="编码" placeholder="请输入编码"
                                              isRequired isInvalid={!!fieldState.error} errorMessage={fieldState.error?.message}
                                              size="sm" className="w-28 shrink-0"
                                              onValueChange={v => { f.onChange(v); updateMeta(field.id, { hasChecked: false, conflict: null }) }}
                                            />
                                          )}
                                        />
                                      </div>
                                    ) : (
                                      /* Create */
                                      <div className="flex flex-wrap gap-2">
                                        {/* Group 1: 类型 + 词 */}
                                        <div className="flex gap-2 flex-1 min-w-44">
                                          <Controller
                                            name={`items.${index}.type`}
                                            control={control}
                                            render={({ field: f }) => (
                                              <Select label="类型" selectedKeys={[f.value]} onSelectionChange={keys => f.onChange(Array.from(keys)[0] as string)} disallowEmptySelection size="sm" className="w-24 shrink-0">
                                                {getPhraseTypeOptions().map(o => <SelectItem key={o.value}>{o.label}</SelectItem>)}
                                              </Select>
                                            )}
                                          />
                                          <Controller
                                            name={`items.${index}.word`}
                                            control={control}
                                            rules={{ required: '词不能为空' }}
                                            render={({ field: f, fieldState }) => {
                                              const inf = inferResults.get(field.id)
                                              return (
                                                <Input
                                                  value={f.value} label="词" placeholder="请输入词"
                                                  isRequired isInvalid={!!fieldState.error} errorMessage={fieldState.error?.message}
                                                  size="sm" className="flex-1"
                                                  onValueChange={v => { f.onChange(v); updateMeta(field.id, { hasChecked: false, conflict: null }) }}
                                                  endContent={
                                                    <div className="flex items-center gap-1">
                                                      {inf && inf.wordExists.length > 0 && <Tooltip content={`词条已存在，编码：${inf.wordExists.map(e => e.code).join('、')}`}><Chip size="sm" variant="flat" color="warning" className="h-5 text-[10px] cursor-default">已存在</Chip></Tooltip>}
                                                      {f.value && <WordCodesPopover word={f.value}><Button size="sm" variant="light" isIconOnly className="min-w-unit-6 w-6 h-6"><Eye className="w-4 h-4" /></Button></WordCodesPopover>}
                                                    </div>
                                                  }
                                                />
                                              )
                                            }}
                                          />
                                        </div>
                                        {/* Group 2: 编码 + 权重 */}
                                        <div className="flex gap-2">
                                          <Controller
                                            name={`items.${index}.code`}
                                            control={control}
                                            rules={{ required: '编码不能为空', pattern: { value: CODE_PATTERN, message: '编码格式错误' } }}
                                            render={({ field: f, fieldState }) => (
                                              <Input
                                                value={f.value} label="编码" placeholder="请输入编码"
                                                isRequired isInvalid={!!fieldState.error} errorMessage={fieldState.error?.message}
                                                color={fieldState.error ? 'danger' : 'default'}
                                                size="sm" className="flex-1"
                                                onValueChange={v => { f.onChange(v); updateMeta(field.id, { hasChecked: false, conflict: null }); autoFilledRef.current.delete(field.id) }}
                                                endContent={
                                                  encodingFields.has(field.id) ? (
                                                    <WandSparkles className="w-4 h-4 animate-pulse" />
                                                  ) : f.value ? (
                                                    <div className="flex items-center gap-1">
                                                      {autoFilledRef.current.has(field.id) && (() => {
                                                        const inf = inferResults.get(field.id)
                                                        const slotIdx = inf?.suggestionIndex ?? 0
                                                        return inf?.isBaseConflict ? (
                                                          <Tooltip content={`基础码已占用，跳至第 ${slotIdx + 1} 位`}><Chip size="sm" variant="flat" color="warning" className="h-5 text-[10px]">+{slotIdx}</Chip></Tooltip>
                                                        ) : (
                                                          <Tooltip content="自动识别编码"><Chip size="sm" variant="flat" color="primary" className="h-5 text-[10px]">自动</Chip></Tooltip>
                                                        )
                                                      })()}
                                                      <CodePhrasesPopover code={f.value}><Button size="sm" variant="light" isIconOnly className="min-w-unit-6 w-6 h-6"><Eye className="w-4 h-4" /></Button></CodePhrasesPopover>
                                                    </div>
                                                  ) : null
                                                }
                                              />
                                            )}
                                          />
                                          <Controller
                                            name={`items.${index}.weight`}
                                            control={control}
                                            render={({ field: f }) => {
                                              const t = watch(`items.${index}.type`) as PhraseType
                                              return <Input value={f.value} label="权重" type="number" placeholder={`${getDefaultWeight(t)}`} size="sm" className="w-16 shrink-0" onValueChange={v => f.onChange(v)} />
                                            }}
                                          />
                                        </div>
                                      </div>
                                    )}

                                    {(() => {
                                      const inf = inferResults.get(field.id)
                                      const currentCode = watch(`items.${index}.code`)
                                      const flyKeyCodes = [...new Set((inf?.flyKeyVariants ?? []).flatMap(variant => variant.codes))]
                                      if (act === 'Delete' || flyKeyCodes.length === 0) return null
                                      const visibleCodes = flyKeyCodes.slice(0, 12)
                                      return (
                                        <div className="flex items-center gap-1.5 overflow-x-auto px-1 py-0.5">
                                          <span className="text-xs text-default-500 shrink-0">飞键</span>
                                          {visibleCodes.map(code => (
                                            <Button
                                              key={code}
                                              size="sm"
                                              variant={currentCode === code ? 'solid' : 'flat'}
                                              color={currentCode === code ? 'primary' : 'default'}
                                              className="h-6 min-w-0 px-2 text-xs shrink-0"
                                              onPress={() => applyFlyKeyCode(index, field.id, code)}
                                            >
                                              {code}
                                            </Button>
                                          ))}
                                          {flyKeyCodes.length > visibleCodes.length && (
                                            <Tooltip content={flyKeyCodes.slice(visibleCodes.length).join('、')}>
                                              <Chip size="sm" variant="flat" className="h-6 text-xs shrink-0">+{flyKeyCodes.length - visibleCodes.length}</Chip>
                                            </Tooltip>
                                          )}
                                        </div>
                                      )
                                    })()}

                                    {/* Type mismatch inline warning */}
                                    {(() => {
                                      const cw = watch(`items.${index}.word`)
                                      const cc = watch(`items.${index}.code`)
                                      const ct = watch(`items.${index}.type`) as PhraseType
                                      if (!cw) return null
                                      const tm = checkTypeMismatch(cw, cc, ct)
                                      if (!tm.hasTypeMismatch) return null
                                      return (
                                        <div className="flex items-center gap-2 px-2 py-1 bg-warning-50/60 dark:bg-warning-100/5 rounded-lg border border-warning-200/60">
                                          <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0" />
                                          <span className="text-xs text-warning-700 dark:text-warning-400 flex-1">类型应为 {tm.suggestedTypeLabel}</span>
                                          <Button size="sm" color="warning" variant="flat" className="h-6 px-2 text-xs shrink-0" onPress={() => { if (tm.suggestedType) { setValue(`items.${index}.type`, tm.suggestedType); toast.success(`已修改为${tm.suggestedTypeLabel}`) } }}>修改</Button>
                                        </div>
                                      )
                                    })()}

                                    {(() => {
                                      const cc = watch(`items.${index}.code`)
                                      const analysis = inferResults.get(field.id)?.requestedCodeAnalysis
                                      if (!cc || !analysis || analysis.supported) return null
                                      const supported = analysis.seriesCodes?.join('、') || analysis.alternatives.slice(0, 8).join('、')
                                      const tone = analysis.matchType === 'sameSeries' ? 'warning' : 'danger'
                                      return (
                                        <div className={`flex items-center gap-2 px-2 py-1 rounded-lg border ${tone === 'warning' ? 'bg-warning-50/60 dark:bg-warning-100/5 border-warning-200/60' : 'bg-danger-50/60 dark:bg-danger-100/5 border-danger-200/60'}`}>
                                          <AlertTriangle className={`w-3.5 h-3.5 shrink-0 ${tone === 'warning' ? 'text-warning' : 'text-danger'}`} />
                                          <span className={`text-xs flex-1 ${tone === 'warning' ? 'text-warning-700 dark:text-warning-400' : 'text-danger-700 dark:text-danger-400'}`}>
                                            {analysis.message}{supported ? `；支持：${supported}` : ''}
                                          </span>
                                        </div>
                                      )
                                    })()}

                                    {/* Remark (optional) */}
                                    {act !== 'Delete' && (
                                      <Controller
                                        name={`items.${index}.remark`}
                                        control={control}
                                        render={({ field: f }) => (
                                          <Textarea value={f.value} label="备注" placeholder="可选，说明修改原因" minRows={1} size="sm" onValueChange={v => f.onChange(v)} />
                                        )}
                                      />
                                    )}

                                    {/* Conflict info — compact */}
                                    {meta.conflict && (
                                      <div className={`rounded-lg px-3 py-2 text-xs space-y-1 ${meta.conflict.hasConflict ? 'bg-danger-50 dark:bg-danger-100/10 border border-danger-200' :
                                        hasWarning ? 'bg-warning-50 dark:bg-warning-100/10 border border-warning-200' :
                                          'bg-success-50 dark:bg-success-100/10 border border-success-200'
                                        }`}>
                                        {meta.conflict.hasConflict ? (
                                          <>
                                            <div className="flex items-center gap-1.5 font-medium text-danger-700 dark:text-danger-400">
                                              <AlertTriangle className="w-3 h-3 shrink-0" /> 冲突：{meta.conflict.impact}
                                            </div>
                                            {meta.conflict.suggestions.filter(s => s.action !== 'Resolved').map((sug, i) => (
                                              <div key={i} className="flex justify-between items-center">
                                                <span className="text-default-600">{sug.reason}{sug.toCode && ` → ${sug.toCode}`}</span>
                                                {sug.toCode && sug.action === 'Adjust' && <Button size="sm" color="danger" variant="flat" className="h-5 px-2 text-[10px]" onPress={() => applySuggestion(index, sug)}>应用</Button>}
                                              </div>
                                            ))}
                                          </>
                                        ) : isResolved ? (
                                          <div className="flex items-center gap-1.5 text-success-700 dark:text-success-400"><Check className="w-3 h-3" /> 已解决</div>
                                        ) : hasWarning && meta.conflict.currentPhrase ? (
                                          <>
                                            <div className="flex items-center gap-1.5 font-medium text-warning-700 dark:text-warning-400">
                                              <AlertTriangle className="w-3 h-3 shrink-0" /> {meta.conflict.impact || '重码警告'}
                                            </div>
                                            <div className="text-default-600">现有：{meta.conflict.currentPhrase.word} @ {meta.conflict.currentPhrase.code}</div>
                                            {meta.conflict.suggestions.filter(s => s.action === 'Adjust').map((sug, i) => (
                                              <div key={i} className="flex justify-between items-center">
                                                <span className="text-default-600">{sug.reason}{sug.toCode && ` → ${sug.toCode}`}</span>
                                                {sug.toCode && <Button size="sm" color="warning" variant="flat" className="h-5 px-2 text-[10px]" onPress={() => applySuggestion(index, sug)}>应用</Button>}
                                              </div>
                                            ))}
                                          </>
                                        ) : (
                                          <div className="flex items-center gap-1.5 text-success-700 dark:text-success-400">
                                            <Check className="w-3 h-3" /> 无冲突{meta.conflict.impact ? `：${meta.conflict.impact}` : ''}
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </>
                                )
                              }}
                            />
                          </div>
                          {/* Context after */}
                          {context?.after && context.after.length > 0 && context.after.map((p, i) => (
                            <div key={i} className="flex items-center gap-2 px-3 py-0.5 font-mono text-xs text-default-500 dark:text-default-400 bg-default-100 dark:bg-default-50/30">
                              <span className="w-4 shrink-0 text-center text-default-300"> </span>
                              <span className="shrink-0">{p.word}</span>
                              <span className="shrink-0">{p.code}</span><span className="shrink-0 text-default-300">{p.weight}</span>

                            </div>
                          ))}
                        </div>
                      ) : (
                        /* ── DIFF ROW (collapsed) ────────────────── */
                        <div
                          onClick={() => setExpandedIndex(index)}
                          className={`rounded-xl border cursor-pointer select-none group transition-colors overflow-hidden ${isIncomplete ? 'border-dashed border-default-300' :
                            hasConflict ? 'border-danger-300' :
                              hasWarning ? 'border-warning-300' :
                                currentAction === 'Delete' ? 'border-danger-200/60' :
                                  currentAction === 'Change' ? 'border-warning-200/60' :
                                    'border-success-200/60'
                            }`}
                        >
                          {/* Context before */}
                          {context?.before && context.before.length > 0 && context.before.map((p, i) => (
                            <div key={i} className="flex items-center gap-2 px-3 py-0.5 font-mono text-xs text-default-500 dark:text-default-400 bg-default-100 dark:bg-default-50/30">
                              <span className="w-4 shrink-0 text-center text-default-300"> </span>
                              <span className="shrink-0">{p.word}</span>
                              <span className="shrink-0">{p.code}</span><span className="shrink-0 text-default-300">{p.weight}</span>

                            </div>
                          ))}
                          {/* Main action line */}
                          <div className={`flex items-center gap-2 px-3 py-2 ${isIncomplete ? 'bg-default-50 dark:bg-default-100/10' :
                            hasConflict ? 'bg-danger-50/50 dark:bg-danger-950/30' :
                              hasWarning ? 'bg-warning-50/50 dark:bg-warning-950/30' :
                                currentAction === 'Delete' ? 'bg-danger-50/20 dark:bg-danger-950/25' :
                                  currentAction === 'Change' ? 'bg-warning-50/20 dark:bg-warning-950/25' :
                                    'bg-success-50/20 dark:bg-success-950/25'
                            }`}>
                            {/* Action symbol */}
                            <span className={`font-mono font-bold text-base shrink-0 w-4 text-center ${currentAction === 'Delete' ? 'text-danger' :
                              currentAction === 'Change' ? 'text-warning' : 'text-success'
                              }`}>
                              {currentAction === 'Delete' ? '−' : currentAction === 'Change' ? '~' : '+'}
                            </span>
                            {/* Content */}
                            <div className="flex-1 font-mono text-sm min-w-0">
                              {currentAction === 'Change' ? (
                                <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                                  <span className="text-danger/60 line-through shrink-0">{currentOldWord || <span className="text-default-300 font-normal text-xs">旧词</span>}</span>
                                  <span className="text-default-300 shrink-0">→</span>
                                  <span className="font-semibold text-default-800 dark:text-white shrink-0">{currentWord || <span className="text-default-300 font-normal text-xs">新词</span>}</span>
                                  {currentCode && <><span className="text-default-300 shrink-0">·</span><span className="text-primary shrink-0">{currentCode}</span></>}
                                  {currentType && <span className="text-default-400 text-xs shrink-0">[{getPhraseTypeOptions().find(o => o.value === currentType)?.label || currentType}]</span>}
                                </div>
                              ) : (
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <span className={`font-semibold truncate ${currentAction === 'Delete' ? 'text-danger' : 'text-default-800 dark:text-white'}`}>
                                    {currentWord || <span className="text-default-300 font-normal text-xs">未填写</span>}
                                  </span>
                                  {currentCode && (
                                    <><span className="text-default-300 shrink-0">→</span><span className="text-primary shrink-0">{currentCode}</span></>
                                  )}
                                  {currentType && (
                                    <span className="text-default-400 text-xs shrink-0">
                                      [{getPhraseTypeOptions().find(o => o.value === currentType)?.label || currentType}]
                                      {currentAction !== 'Delete' && ` ${currentWeight}`}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                            {/* Status chips */}
                            {isIncomplete && <Chip size="sm" variant="flat" color="default" className="h-4 text-[10px] shrink-0">未完成</Chip>}
                            {hasConflict && <Chip size="sm" variant="flat" color="danger" className="h-4 text-[10px] shrink-0">冲突</Chip>}
                            {hasWarning && <Chip size="sm" variant="flat" color="warning" className="h-4 text-[10px] shrink-0">重码</Chip>}
                            {infer?.wordExists && infer.wordExists.length > 0 && <Chip size="sm" variant="flat" color="warning" className="h-4 text-[10px] shrink-0">词存在</Chip>}
                            {isResolved && <Chip size="sm" variant="flat" color="success" className="h-4 text-[10px] shrink-0">✓</Chip>}
                            {/* Hover actions */}
                            {!isEditMode && fields.length > 1 && (
                              <div className="flex gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                                <Button size="sm" color="danger" variant="light" isIconOnly className="w-6 h-6 min-w-0" onPress={() => handleRemoveItem(index)}><Trash2 className="w-3" /></Button>
                              </div>
                            )}
                          </div>
                          {/* Context after */}
                          {context?.after && context.after.length > 0 && context.after.map((p, i) => (
                            <div key={i} className="flex items-center gap-2 px-3 py-0.5 font-mono text-xs text-default-500 dark:text-default-400 bg-default-100 dark:bg-default-50/30">
                              <span className="w-4 shrink-0 text-center text-default-300"> </span>
                              <span className="shrink-0">{p.word}</span>
                              <span className="shrink-0">{p.code}</span><span className="shrink-0 text-default-300">{p.weight}</span>

                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
                {/* Add button — full-width below accordion */}
                {!isEditMode && (
                  <div className="flex gap-2 pt-1.5 pb-1">
                    <Button size="sm" color="primary" variant="bordered" className="flex-1" onPress={handleAddItem} startContent={<Plus size={13} />}>添加</Button>
                  </div>
                )}
              </ModalBody>
              <ModalFooter className="flex-col gap-2">
                <div className="flex gap-2 w-full items-center">
                  <Button
                    color="secondary"
                    variant="flat"
                    size="sm"
                    onPress={handleCheckAllConflicts}
                    isLoading={checkingAll}
                    startContent={!checkingAll && <Search className="w-3.5 h-3.5" />}
                  >
                    检测冲突
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
                        color="secondary"
                        variant="bordered"
                        size="sm"
                        onPress={() => setShowDictParser(true)}
                        startContent={<FileText size={14} />}
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
        onClose={closeDictParser}
        size={dictStep === 'preview' ? '3xl' : '2xl'}
        scrollBehavior="inside"
      >
        <ModalContent>
          {() => (
            <>
              <ModalHeader>
                <div className="flex items-center justify-between w-full gap-2">
                  <span>Rime词典解析</span>
                  {dictStep === 'preview' && !dictInferring && (
                    <Chip size="sm" variant="flat" className="shrink-0">
                      {dictItems.filter(i => !i.excluded && i.finalCode.trim()).length}/{dictItems.length} 条待导入
                    </Chip>
                  )}
                </div>
              </ModalHeader>
              <ModalBody className="gap-3">
                {dictStep === 'input' ? (
                  <div className="space-y-3">
                    <p className="text-sm text-default-600">
                      支持两种格式，每行一条：
                      <code className="bg-content2 px-1 rounded mx-1">词条</code>（自动推断编码）
                      或
                      <code className="bg-content2 px-1 rounded mx-1">词条[Tab/空格]编码</code>（使用提供的编码）
                    </p>
                    <Textarea
                      placeholder={"程序员\n算法\t可选编码\n的\n..."}
                      value={dictInput}
                      onValueChange={setDictInput}
                      minRows={12}
                      classNames={{ input: "font-mono text-sm" }}
                      onKeyDown={(e) => {
                        if (e.key === 'Tab') {
                          e.preventDefault()
                          const el = e.currentTarget as HTMLTextAreaElement
                          const start = el.selectionStart
                          const end = el.selectionEnd
                          const next = dictInput.slice(0, start) + '\t' + dictInput.slice(end)
                          setDictInput(next)
                          requestAnimationFrame(() => {
                            el.selectionStart = el.selectionEnd = start + 1
                          })
                        }
                      }}
                    />
                  </div>
                ) : (
                  <div className="space-y-2">
                    {dictInferring && (
                      <div className="px-3 py-2 bg-primary-50 dark:bg-primary-100/10 rounded-lg text-sm text-primary-600 dark:text-primary-400 animate-pulse">
                        正在批量推断编码并检查词库…
                      </div>
                    )}
                    <div className="flex justify-between items-center px-1">
                      <span className="text-xs text-default-500">{dictItems.length} 个词条</span>
                      <div className="flex gap-1">
                        <Button size="sm" variant="light" className="h-6 min-w-0 px-2 text-xs" onPress={() => setDictItems(prev => prev.map(i => ({ ...i, excluded: false })))}>全选</Button>
                        <Button size="sm" variant="light" className="h-6 min-w-0 px-2 text-xs" onPress={() => setDictItems(prev => prev.map(i => ({ ...i, excluded: true })))}>全不选</Button>
                      </div>
                    </div>
                    <div className="space-y-1">
                      {dictItems.map((item, idx) => (
                        <div
                          key={item.key}
                          className={`flex items-center gap-2 px-2 py-1.5 rounded-lg border text-sm transition-opacity ${item.excluded ? 'opacity-40 bg-default-50 border-default-100' :
                            item.status === 'overflow' ? 'bg-danger-50/50 dark:bg-danger-50/10 border-danger-100 dark:border-danger-800' :
                              item.status === 'error' ? 'bg-danger-50/50 dark:bg-danger-50/10 border-danger-100 dark:border-danger-800' :
                                (item.infer?.wordExists?.length ?? 0) > 0 ? 'bg-warning-50/50 dark:bg-warning-50/10 border-warning-100 dark:border-warning-800' :
                                  item.status === 'shifted' ? 'bg-primary-50/50 dark:bg-primary-50/10 border-primary-100 dark:border-primary-800' :
                                    'bg-success-50/50 dark:bg-success-50/10 border-success-100 dark:border-success-800'
                            }`}
                        >
                          {/* Toggle */}
                          <button
                            onClick={() => setDictItems(prev => prev.map((d, i) => i === idx ? { ...d, excluded: !d.excluded } : d))}
                            className={`w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center text-[8px] font-bold transition-colors ${!item.excluded ? 'bg-primary border-primary text-white' : 'border-default-300 bg-content1'
                              }`}
                          >
                            {!item.excluded && '✓'}
                          </button>
                          {/* Word */}
                          <span className="w-20 font-mono font-semibold text-sm truncate shrink-0">{item.word}</span>
                          {/* Code (editable) */}
                          <Input
                            size="sm"
                            value={item.finalCode}
                            placeholder={item.status === 'inferring' ? '推断中…' : '编码'}
                            isDisabled={item.status === 'inferring' || item.excluded}
                            className="w-24 shrink-0"
                            classNames={{ input: "font-mono text-xs" }}
                            onValueChange={v => updateDictItemCode(idx, v)}
                          />
                          {/* Status badges */}
                          <div className="flex-1 flex items-center gap-1 min-w-0 overflow-hidden">
                            {item.status === 'inferring' && <Chip size="sm" variant="flat" className="h-4 text-[10px] shrink-0 animate-pulse">推断中</Chip>}
                            {item.status === 'new' && <Chip size="sm" variant="flat" color="success" className="h-4 text-[10px] shrink-0">✓ 新词条</Chip>}
                            {item.status === 'shifted' && <Chip size="sm" variant="flat" color="primary" className="h-4 text-[10px] shrink-0">码位跳转</Chip>}
                            {item.status === 'overflow' && <Chip size="sm" variant="flat" color="danger" className="h-4 text-[10px] shrink-0">重码</Chip>}
                            {item.status === 'error' && <Chip size="sm" variant="flat" color="danger" className="h-4 text-[10px] shrink-0">推断失败</Chip>}
                            {(item.infer?.wordExists?.length ?? 0) > 0 && (
                              <Chip size="sm" variant="flat" color="warning" className="h-4 text-[10px] shrink-0">词已存在</Chip>
                            )}
                            {item.statusDetail && (
                              <span className="text-[10px] text-default-500 truncate">{item.statusDetail}</span>
                            )}
                          </div>
                          <Chip size="sm" variant="flat" className="h-4 text-[10px] shrink-0">{item.type}</Chip>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </ModalBody>
              <ModalFooter>
                {dictStep === 'input' ? (
                  <>
                    <Button variant="light" onPress={closeDictParser}>取消</Button>
                    <Button color="primary" onPress={handleDictPreview} isDisabled={!dictInput.trim()}>
                      解析预览
                    </Button>
                  </>
                ) : (
                  <>
                    <Button variant="light" onPress={() => { setDictStep('input'); setDictItems([]) }}>重新输入</Button>
                    <Button variant="light" onPress={closeDictParser}>取消</Button>
                    <Button
                      color="primary"
                      onPress={handleDictConfirm}
                      isDisabled={dictInferring || dictItems.filter(i => !i.excluded && i.finalCode.trim()).length === 0}
                    >
                      一键导入 ({dictItems.filter(i => !i.excluded && i.finalCode.trim()).length}条)
                    </Button>
                  </>
                )}
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </>
  )
}
