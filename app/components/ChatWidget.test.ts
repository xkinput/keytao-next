// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/lib/store/auth'
import { useChatStore } from '@/lib/store/chat'
import ChatWidget from './ChatWidget'

vi.mock('next/dynamic', () => ({ default: () => () => null }))

const chatUrl = '/api/bot/chat'
const refreshUrl = '/api/auth/refresh'
const loginPrompt = '请先登录后再和喵喵聊天'
const unavailable = '喵喵暂时连不上，请稍后再试'
const unauthorized = () => Response.json({ error: '未登录' }, { status: 401 })
const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>()
let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('innerWidth', 500)
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  useAuthStore.getState().setAuth('old-token', { id: 1, name: 'test' })
  useChatStore.setState({ ...useChatStore.getInitialState(), sessionId: 'session-1' })
  container = document.body.appendChild(document.createElement('div'))
  root = createRoot(container)
})

afterEach(async () => {
  await act(() => root.unmount())
  container.remove()
  useAuthStore.getState().clearAuth()
  vi.unstubAllGlobals()
})

async function openChat() {
  await act(() => root.render(createElement(ChatWidget)))
  const launcher = container.querySelector<HTMLButtonElement>('button[aria-label="打开键道助手"]')!
  await act(() => launcher.click())
  expect(useChatStore.getState().isOpen).toBe(true)
}

async function sendMessage() {
  const input = container.querySelector('textarea')!
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '你好')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(() => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })
}

function expectLoginPrompt() {
  expect(container.textContent).toContain(loginPrompt)
  expect(container.querySelector('a[href="/login"]')?.textContent).toBe('前往登录')
  expect(container.querySelector('textarea')).toBeNull()
}

it.each(['POST', 'DELETE'])('refreshes and retries a chat %s with the new token', async method => {
  fetchMock.mockResolvedValueOnce(unauthorized())
    .mockResolvedValueOnce(Response.json({ token: 'new-token' }))
    .mockResolvedValueOnce(Response.json({ reply: '刷新后收到的回复' }))

  await openChat()
  if (method === 'POST') {
    await sendMessage()
    expect(container.textContent).toContain('刷新后收到的回复')
  } else {
    await act(() => container.querySelector<HTMLButtonElement>('button[aria-label="清空"]')!.click())
    expect(container.textContent).toContain('对话已清空')
  }

  expect(fetchMock.mock.calls.map(([url, init]) => [url, init.method, new Headers(init.headers).get('Authorization')])).toEqual([
    [chatUrl, method, 'Bearer old-token'],
    [refreshUrl, 'POST', 'Bearer old-token'],
    [chatUrl, method, 'Bearer new-token'],
  ])
  const body = method === 'POST' ? { message: '你好', session_id: 'session-1' } : { session_id: 'session-1' }
  expect(fetchMock.mock.calls[0][1].body).toBe(JSON.stringify(body))
  expect(fetchMock.mock.calls[2][1].body).toBe(JSON.stringify(body))
  expect(useAuthStore.getState().token).toBe('new-token')
  const signal = fetchMock.mock.calls[0][1].signal
  expect(signal).toBeInstanceOf(AbortSignal)
  expect(fetchMock.mock.calls[1][1].signal).toBe(signal)
  expect(fetchMock.mock.calls[2][1].signal).toBe(signal)
})

it('shows the login prompt when the retried chat request still returns 401', async () => {
  fetchMock.mockResolvedValueOnce(unauthorized())
    .mockResolvedValueOnce(Response.json({ token: 'rejected-token' }))
    .mockResolvedValueOnce(unauthorized())
  await openChat()
  await sendMessage()

  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([chatUrl, refreshUrl, chatUrl])
  expectLoginPrompt()
  await act(() => useAuthStore.getState().setAuth('login-token', { id: 1, name: 'test' }))
  expect(container.querySelector('textarea')).not.toBeNull()
})

it('shows the login prompt when the refresh endpoint rejects the token', async () => {
  fetchMock.mockResolvedValueOnce(unauthorized()).mockResolvedValueOnce(unauthorized())
  await openChat()
  await sendMessage()

  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([chatUrl, refreshUrl])
  expectLoginPrompt()
})

it('keeps the launcher available and shows the login prompt without a token', async () => {
  useAuthStore.getState().clearAuth()
  await openChat()

  expectLoginPrompt()
  expect(fetchMock).not.toHaveBeenCalled()
})

it.each([
  [429, '说得太快啦，稍等一下再试'],
  [502, unavailable],
  [503, unavailable],
  [504, unavailable],
  [500, '呜呜，连接 bot 失败了 qwq'],
] as const)('shows the appropriate message after a retried request returns %d', async (status, message) => {
  fetchMock.mockResolvedValueOnce(unauthorized())
    .mockResolvedValueOnce(Response.json({ token: 'new-token' }))
    .mockResolvedValueOnce(new Response('<html>Request failed</html>', { status }))
  await openChat()
  await sendMessage()

  expect(container.textContent).toContain(message)
  expect(container.querySelector('textarea')).not.toBeNull()
})

it.each([new TypeError('Failed to fetch'), new DOMException('Request timed out', 'TimeoutError')])(
  'shows a temporary outage on %s', async error => {
    fetchMock.mockRejectedValueOnce(error)
    await openChat()
    await sendMessage()

    expect(container.textContent).toContain(unavailable)
    expect(container.querySelector('textarea')).not.toBeNull()
  },
)

it('shows a temporary outage when the refresh response body times out', async () => {
  const refresh = Response.json({ token: 'new-token' })
  vi.spyOn(refresh, 'json').mockRejectedValueOnce(new DOMException('Request timed out', 'AbortError'))
  fetchMock.mockResolvedValueOnce(unauthorized()).mockResolvedValueOnce(refresh)
  await openChat()
  await sendMessage()

  expect(container.textContent).toContain(unavailable)
  expect(container.querySelector('textarea')).not.toBeNull()
})
