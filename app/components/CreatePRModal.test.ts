// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import toast from 'react-hot-toast'
import { expect, it, vi } from 'vitest'
import CreatePRModal, { buildEditFormItem } from './CreatePRModal'
import { MIAOMIAO_REVIEW_BLOCK_END, MIAOMIAO_REVIEW_BLOCK_START } from '@/lib/services/miaomiaoReviewRemark'

vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }))

it('loads only the author remark into the editable item', () => {
  const item = { id: 1, action: 'Create', word: '试词', code: 'ceui' } as const
  const reviewBlock = `${MIAOMIAO_REVIEW_BLOCK_START}\n本喵复审：需复核\n${MIAOMIAO_REVIEW_BLOCK_END}`
  expect(buildEditFormItem({ ...item, remark: `作者备注\n\n${reviewBlock}` }).remark).toBe('作者备注')
  expect(buildEditFormItem({ ...item, remark: reviewBlock }).remark).toBe('')
})

it('requires conflict clearance before saving and never requests a pre-submit review', async () => {
  const conflictUrl = '/api/pull-requests/check-conflicts-batch'
  const saveUrl = '/api/pull-requests/1'
  let hasConflict = true
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/phrases/context?')) return Response.json({ before: [], at: [], after: [] })
    if (url === conflictUrl) {
      const { items } = JSON.parse(String(init?.body))
      return Response.json({
        results: items.map(({ id }: { id: string }) => ({
          id, conflict: { code: 'ceui', hasConflict, suggestions: [] },
        })),
        warnings: [],
      })
    }
    if (url === saveUrl) return Response.json({})
    throw new Error(`Unexpected request: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.body.appendChild(document.createElement('div'))
  const root = createRoot(container)
  const onSuccess = vi.fn()
  const button = (label: string) => [...document.querySelectorAll('button')]
    .find(button => button.textContent?.trim() === label)!

  try {
    await act(() => root.render(createElement(CreatePRModal, {
      isOpen: true,
      onClose: vi.fn(),
      onSuccess,
      batchContentVersion: 3,
      editPR: { id: 1, action: 'Create', word: '试词', code: 'ceui', type: 'Phrase' },
    })))
    expect(button('保存').disabled).toBe(true)
    await act(() => button('检查冲突').click())
    expect(button('保存').disabled).toBe(true)

    hasConflict = false
    await act(() => button('检查冲突').click())
    expect(button('保存').disabled).toBe(false)
    await act(() => button('保存').click())

    expect(onSuccess).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET')
      .map(([url]) => url)).toEqual([conflictUrl, conflictUrl, conflictUrl, saveUrl])
  } finally {
    await act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  }
})

it('shows only the error toast when draft ordering returns HTTP 502', async () => {
  const orderUrl = '/api/phrases/commonness-order'
  const fetchMock = vi.fn(async (url: string) => {
    if (url.startsWith('/api/phrases/context?')) return Response.json({ before: [], at: [], after: [] })
    if (url === orderUrl) return Response.json({ error: 'Bad Gateway' }, { status: 502 })
    throw new Error(`Unexpected request: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.body.appendChild(document.createElement('div'))
  const root = createRoot(container)

  try {
    await act(() => root.render(createElement(CreatePRModal, {
      isOpen: true,
      onClose: vi.fn(),
      onSuccess: vi.fn(),
      batchPRs: ['草稿词', '另一个词'].map((word, index) => ({
        id: index + 1, action: 'Create' as const, word, code: 'ceui', type: 'Phrase',
      })),
    })))
    const orderButton = [...document.querySelectorAll('button')]
      .find(button => button.textContent?.includes('AI 重排并生成编码'))
    expect(orderButton).toBeDefined()
    await act(() => orderButton!.click())

    expect(fetchMock).toHaveBeenCalledWith(orderUrl, expect.objectContaining({ method: 'POST' }))
    expect(toast.error).toHaveBeenCalledExactlyOnceWith('排序服务暂不可用')
    expect(toast.success).not.toHaveBeenCalled()
  } finally {
    await act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  }
})
