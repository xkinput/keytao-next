'use client'

import React, { useRef, useEffect, useCallback, useState } from 'react'
import dynamic from 'next/dynamic'
import { Button, Textarea, ScrollShadow } from '@/lib/heroui-compat'
import { Trash2, X, Send, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, MessageCircle } from 'lucide-react'
import { useChatStore } from '@/lib/store/chat'
import { useAuthStore } from '@/lib/store/auth'

const Live2DCanvas = dynamic(() => import('./Live2DCanvas'), { ssr: false })

const CANVAS_W = 96
const CANVAS_H = 106
const CANVAS_W_MOBILE = 86
const CANVAS_H_MOBILE = 94

// Idle messages that rotate in the speech bubble
const IDLE_MESSAGES = [
  '需要帮助时点这里',
  '可以问我键道相关问题',
  '键道助手在这里',
  '需要帮助吗？',
]

const SNAP_THRESHOLD = 60
const STORAGE_KEY = 'chatwidget-pos'

type SnapEdge = 'left' | 'right' | 'top' | 'bottom' | null
interface WidgetState { x: number; y: number; snap: SnapEdge }

function saveWidgetState(s: WidgetState) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)) } catch { }
}

function loadWidgetState(): WidgetState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as WidgetState
  } catch { }
  return null
}

function authHeaders(): Record<string, string> {
  const token = useAuthStore.getState().token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function sendChat(message: string, sessionId: string): Promise<string> {
  const res = await fetch('/api/bot/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ message, session_id: sessionId }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  return data.reply as string
}

async function clearServerHistory(sessionId: string) {
  await fetch('/api/bot/chat', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ session_id: sessionId }),
  }).catch(() => { })
}

// ── Snap restore tab ────────────────────────────────────────────────────────────
function SnapRestoreButton({ snap, pos, canvasW, canvasH, onRestore }: {
  snap: NonNullable<SnapEdge>
  pos: { x: number; y: number }
  canvasW: number
  canvasH: number
  onRestore: () => void
}) {
  const midY = pos.y + canvasH / 2 - 20
  const midX = pos.x + canvasW / 2 - 20
  const Icon =
    snap === 'right' ? ChevronLeft :
      snap === 'left' ? ChevronRight :
        snap === 'bottom' ? ChevronUp : ChevronDown
  const isHorizontal = snap === 'left' || snap === 'right'
  const posStyle =
    snap === 'right' ? { right: 0, top: midY } :
      snap === 'left' ? { left: 0, top: midY } :
        snap === 'bottom' ? { bottom: 0, left: midX } :
          { top: 0, left: midX }
  const borderRadius =
    snap === 'right' ? '8px 0 0 8px' :
      snap === 'left' ? '0 8px 8px 0' :
        snap === 'bottom' ? '8px 8px 0 0' : '0 0 8px 8px'

  return (
    <div style={{ position: 'absolute', pointerEvents: 'auto', ...posStyle }}>
      <button
        onClick={onRestore}
        aria-label="显示角色"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: isHorizontal ? 20 : 40,
          height: isHorizontal ? 40 : 20,
          background: 'var(--surface)',
          border: '1px solid var(--separator)',
          borderRadius,
          cursor: 'pointer',
          color: 'var(--foreground)',
          opacity: 0.7,
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        }}
      >
        <Icon size={12} />
      </button>
    </div>
  )
}

// ── Speech bubble ─────────────────────────────────────────────────────────────
function SpeechBubble({ visible, text, canvasH }: { visible: boolean; text: string; canvasH: number }) {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: canvasH + 8,
        right: 0,
        pointerEvents: 'none',
        transition: 'opacity 0.4s, transform 0.4s',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(6px)',
        whiteSpace: 'nowrap',
      }}
    >
      <div
        className="rounded-lg px-3 py-1.5 text-xs shadow-md"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--separator)',
          color: 'var(--foreground)',
        }}
      >
        {text}
      </div>
      {/* Arrow pointing down */}
      <div
        style={{
          position: 'absolute',
          bottom: -6,
          right: 28,
          width: 0,
          height: 0,
          borderLeft: '6px solid transparent',
          borderRight: '6px solid transparent',
          borderTop: '6px solid var(--separator)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: -5,
          right: 28,
          width: 0,
          height: 0,
          borderLeft: '6px solid transparent',
          borderRight: '6px solid transparent',
          borderTop: '6px solid var(--surface)',
        }}
      />
    </div>
  )
}

// ── Chat panel ────────────────────────────────────────────────────────────────
function ChatPanel({ onClose }: { onClose: () => void }) {
  const { messages, loading, addMessage, setLoading, clearMessages, getSessionId } = useChatStore()
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const submit = useCallback(async () => {
    const text = input.trim()
    if (!text || loading) return
    setInput('')
    addMessage('user', text)
    setLoading(true)
    try {
      const reply = await sendChat(text, getSessionId())
      addMessage('assistant', reply)
    } catch {
      addMessage('assistant', '呜呜，连接 bot 失败了 qwq')
    } finally {
      setLoading(false)
    }
  }, [input, loading, addMessage, setLoading, getSessionId])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
  }

  const handleClear = async () => {
    await clearServerHistory(getSessionId())
    clearMessages()
  }

  return (
    <div style={{ width: 'min(320px, calc(100vw - 32px))' }}>
      {/* Toolbar */}
      <div
        className="mb-2 flex items-center justify-between rounded-lg px-3 py-1.5 shadow-sm"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--separator)',
        }}
      >
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-primary" />
          <span className="text-xs font-medium text-foreground-500">喵喵 · 键道助手</span>
        </div>
        <div className="flex items-center gap-0.5">
          <Button isIconOnly variant="light" size="sm" onPress={handleClear} aria-label="清空">
            <Trash2 size={12} />
          </Button>
          <Button isIconOnly variant="light" size="sm" onPress={onClose} aria-label="关闭">
            <X size={14} />
          </Button>
        </div>
      </div>

      {/* Messages — floating bubbles, no panel background */}
      <ScrollShadow
        className="flex flex-col gap-2 overflow-y-auto pr-1"
        style={{ maxHeight: 300 }}
      >
        {messages.map(msg => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[88%] px-3 py-2 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words shadow-sm ${msg.role === 'user'
                ? 'bg-primary text-primary-foreground'
                : 'text-foreground'
                }`}
              style={
                msg.role === 'assistant'
                  ? {
                    background: 'var(--surface)',
                    border: '1px solid var(--separator)',
                  }
                  : undefined
              }
            >
              {msg.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div
              className="px-4 py-2.5 rounded-2xl shadow-sm flex gap-1 items-center"
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--separator)',
              }}
            >
              {[0, 1, 2].map(i => (
                <span
                  key={i}
                  className="w-1.5 h-1.5 rounded-full bg-primary inline-block"
                  style={{ animation: `live2d-bounce 1.2s ease-in-out ${i * 0.2}s infinite` }}
                />
              ))}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </ScrollShadow>

      {/* Input */}
      <div className="flex items-end gap-2 pt-2">
        <Textarea
          value={input}
          onValueChange={setInput}
          onKeyDown={handleKeyDown}
          placeholder="输入消息… (Enter 发送)"
          minRows={1}
          maxRows={3}
          isDisabled={loading}
          classNames={{
            inputWrapper: 'shadow-md',
          }}
          size="sm"
        />
        <Button
          isIconOnly color="primary" size="sm"
          onPress={submit}
          isDisabled={loading || !input.trim()}
          className="mb-0.5 flex-shrink-0"
        >
          <Send size={14} />
        </Button>
      </div>
    </div>
  )
}

// ── Root widget ───────────────────────────────────────────────────────────────
export default function ChatWidget() {
  const { isOpen, open, close } = useChatStore()
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth < 768
  )
  const canvasW = isMobile ? CANVAS_W_MOBILE : CANVAS_W
  const canvasH = isMobile ? CANVAS_H_MOBILE : CANVAS_H

  // Position as top-left offset, persisted to localStorage
  const posRef = useRef({ x: 0, y: 0 })
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [snap, setSnap] = useState<SnapEdge>(null)
  const [initialized, setInitialized] = useState(false)

  const [bubbleVisible, setBubbleVisible] = useState(false)
  const [bubbleText, setBubbleText] = useState(IDLE_MESSAGES[0])
  const bubbleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const msgIdxRef = useRef(0)
  // Timestamp of last drag end — suppress onHit for 300ms after drag
  const dragEndTimeRef = useRef(0)

  // Load saved position once on mount
  useEffect(() => {
    const saved = loadWidgetState()
    if (saved) {
      posRef.current = { x: saved.x, y: saved.y }
      setPos({ x: saved.x, y: saved.y })
      setSnap(saved.snap)
    } else {
      const mobile = window.innerWidth < 768
      const cW = mobile ? CANVAS_W_MOBILE : CANVAS_W
      const cH = mobile ? CANVAS_H_MOBILE : CANVAS_H
      const p = { x: window.innerWidth - cW - 16, y: window.innerHeight - cH - 16 }
      posRef.current = p
      setPos(p)
    }
    setInitialized(true)
  }, [])

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Show bubble 2s after mount, rotate messages every 8s, hide when chat open
  useEffect(() => {
    if (isOpen) {
      setBubbleVisible(false)
      if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current)
      return
    }
    const show = () => {
      msgIdxRef.current = (msgIdxRef.current + 1) % IDLE_MESSAGES.length
      setBubbleText(IDLE_MESSAGES[msgIdxRef.current])
      setBubbleVisible(true)
      bubbleTimerRef.current = setTimeout(() => {
        setBubbleVisible(false)
        bubbleTimerRef.current = setTimeout(show, 5000)
      }, 4000)
    }
    bubbleTimerRef.current = setTimeout(show, 2000)
    return () => { if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current) }
  }, [isOpen])

  const handleHit = useCallback(() => {
    // Ignore click-like events fired right after a drag
    if (Date.now() - dragEndTimeRef.current < 300) return
    if (isOpen) return
    setBubbleVisible(false)
    open()
  }, [isOpen, open])

  // ── Drag handling ─────────────────────────────────────────────────────────
  // Use refs for values needed inside window-listener closures
  const canvasWRef = useRef(canvasW)
  const canvasHRef = useRef(canvasH)
  const closeRef = useRef(close)
  useEffect(() => { canvasWRef.current = canvasW }, [canvasW])
  useEffect(() => { canvasHRef.current = canvasH }, [canvasH])
  useEffect(() => { closeRef.current = close }, [close])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // Do NOT call setPointerCapture — it also captures mouse/click events,
    // which would prevent Live2D canvas from receiving click and opening chat.
    const startX = e.clientX
    const startY = e.clientY
    const origX = posRef.current.x
    const origY = posRef.current.y
    let moved = false

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      if (!moved && dx * dx + dy * dy > 25) moved = true
      if (moved) {
        const p = { x: origX + dx, y: origY + dy }
        posRef.current = p
        setPos(p)
      }
    }

    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (!moved) return

      dragEndTimeRef.current = Date.now()
      const vw = window.innerWidth
      const vh = window.innerHeight
      const x = origX + (ev.clientX - startX)
      const y = origY + (ev.clientY - startY)
      const cW = canvasWRef.current
      const cH = canvasHRef.current

      const cx = x + cW / 2
      const cy = y + cH / 2
      let newSnap: SnapEdge = null
      if (cx < SNAP_THRESHOLD) newSnap = 'left'
      else if (cx > vw - SNAP_THRESHOLD) newSnap = 'right'
      else if (cy < SNAP_THRESHOLD) newSnap = 'top'
      else if (cy > vh - SNAP_THRESHOLD) newSnap = 'bottom'

      const clampedX = Math.max(0, Math.min(vw - cW, x))
      const clampedY = Math.max(0, Math.min(vh - cH, y))
      const finalPos = { x: clampedX, y: clampedY }
      posRef.current = finalPos
      setPos(finalPos)
      setSnap(newSnap)
      if (newSnap) closeRef.current()
      saveWidgetState({ ...finalPos, snap: newSnap })
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [])

  const handleRestore = useCallback(() => {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const p = posRef.current
    const newPos = {
      x: Math.max(16, Math.min(vw - canvasW - 16, p.x)),
      y: Math.max(16, Math.min(vh - canvasH - 16, p.y)),
    }
    posRef.current = newPos
    setPos(newPos)
    setSnap(null)
    saveWidgetState({ ...newPos, snap: null })
  }, [canvasW, canvasH])

  if (initialized && isMobile) {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 40,
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      >
        <div
          style={{
            position: 'absolute',
            right: 12,
            bottom: 76,
            transition: 'opacity 0.25s, transform 0.25s',
            opacity: isOpen ? 1 : 0,
            transform: isOpen ? 'translateY(0)' : 'translateY(12px)',
            pointerEvents: isOpen ? 'auto' : 'none',
          }}
        >
          <ChatPanel onClose={close} />
        </div>
        <Button
          isIconOnly
          color="primary"
          aria-label={isOpen ? '键道助手已打开' : '打开键道助手'}
          onPress={() => {
            setBubbleVisible(false)
            open()
          }}
          className="absolute bottom-4 right-4 h-12 w-12 rounded-lg shadow-[0_14px_34px_hsl(var(--shadow-color)/0.22)]"
          style={{ pointerEvents: 'auto' }}
        >
          <MessageCircle size={20} />
        </Button>
        <style>{`
          @keyframes live2d-bounce {
            0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
            40% { transform: translateY(-4px); opacity: 1; }
          }
        `}</style>
      </div>
    )
  }

  return (
    // Full-screen transparent overlay — pointerEvents:none lets all clicks through
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 40,
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      {/* Snap restore tab — appears at the edge where character was hidden */}
      {initialized && snap && (
        <SnapRestoreButton
          snap={snap}
          pos={pos}
          canvasW={canvasW}
          canvasH={canvasH}
          onRestore={handleRestore}
        />
      )}

      {/* Character widget — only rendered when not snapped */}
      {initialized && !snap && (
        <div
          style={{
            position: 'absolute',
            left: pos.x,
            top: pos.y,
            width: canvasW,
            pointerEvents: 'none',
          }}
        >
          {/* Chat panel — slides in above the character */}
          <div
            style={{
              position: 'absolute',
              right: 0,
              bottom: canvasH + 8,
              transition: 'opacity 0.25s, transform 0.25s',
              opacity: isOpen ? 1 : 0,
              transform: isOpen ? 'translateY(0)' : 'translateY(12px)',
              pointerEvents: isOpen ? 'auto' : 'none',
            }}
          >
            <ChatPanel onClose={close} />
          </div>

          {/* Live2D + speech bubble */}
          <div style={{ position: 'relative', width: canvasW, height: canvasH }}>
            <SpeechBubble visible={bubbleVisible && !isOpen && !isMobile} text={bubbleText} canvasH={canvasH} />
            {/* Drag wrapper — pointerEvents:auto re-enables interactions on this child */}
            <div
              style={{ cursor: 'grab', pointerEvents: 'auto' }}
              onPointerDown={handlePointerDown}
            >
              <Live2DCanvas width={canvasW} height={canvasH} onHit={handleHit} />
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes live2d-bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40% { transform: translateY(-4px); opacity: 1; }
        }
      `}</style>
    </div>
  )
}
