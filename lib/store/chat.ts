'use client'

import { create } from 'zustand'

export interface ChatMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
}

let _id = 0

interface ChatStore {
  isOpen: boolean
  messages: ChatMessage[]
  loading: boolean
  sessionId: string
  open: () => void
  close: () => void
  toggle: () => void
  addMessage: (role: ChatMessage['role'], content: string) => void
  setLoading: (v: boolean) => void
  clearMessages: () => void
  getSessionId: () => string
}

export const useChatStore = create<ChatStore>((set, get) => ({
  isOpen: false,
  loading: false,
  sessionId: '',
  messages: [
    {
      id: ++_id,
      role: 'assistant',
      content: '你好呀～ owo 我是喵喵，键道输入法的 AI 助手！有什么可以帮你的吗？',
    },
  ],

  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set(s => ({ isOpen: !s.isOpen })),
  setLoading: (v) => set({ loading: v }),

  addMessage: (role, content) =>
    set(s => ({ messages: [...s.messages, { id: ++_id, role, content }] })),

  clearMessages: () =>
    set({
      messages: [
        {
          id: ++_id,
          role: 'assistant',
          content: '对话已清空！我们重新开始吧 owo',
        },
      ],
    }),

  getSessionId: () => {
    const { sessionId } = get()
    if (sessionId) return sessionId
    if (typeof window === 'undefined') return ''
    const key = 'keytao_chat_session'
    let id = localStorage.getItem(key)
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem(key, id)
    }
    set({ sessionId: id })
    return id
  },
}))
