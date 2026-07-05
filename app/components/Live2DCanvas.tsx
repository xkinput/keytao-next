'use client'

import { useEffect, useRef, useState } from 'react'

const CUBISM2_RUNTIME_URL = 'https://cdn.jsdelivr.net/gh/dylanNew/live2d/webgl/Live2D/lib/live2d.min.js'
const MODEL_URL =
  process.env.NEXT_PUBLIC_LIVE2D_MODEL ||
  'https://cdn.jsdelivr.net/npm/live2d-widget-model-shizuku@1.0.5/assets/shizuku.model.json'

let cubism2RuntimePromise: Promise<void> | null = null

function hasCubism2Runtime() {
  return typeof window !== 'undefined' && 'Live2D' in window
}

function ensureCubism2Runtime() {
  if (hasCubism2Runtime()) return Promise.resolve()
  if (cubism2RuntimePromise) return cubism2RuntimePromise

  cubism2RuntimePromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${CUBISM2_RUNTIME_URL}"]`)
    const timeout = window.setTimeout(() => {
      reject(new Error('Timed out loading Cubism2 runtime'))
    }, 12000)

    const handleLoad = () => {
      window.clearTimeout(timeout)
      if (hasCubism2Runtime()) resolve()
      else reject(new Error('Cubism2 runtime loaded without Live2D global'))
    }
    const handleError = () => {
      window.clearTimeout(timeout)
      reject(new Error('Failed to load Cubism2 runtime'))
    }

    if (existing) {
      existing.addEventListener('load', handleLoad, { once: true })
      existing.addEventListener('error', handleError, { once: true })
      return
    }

    const script = document.createElement('script')
    script.src = CUBISM2_RUNTIME_URL
    script.async = true
    script.crossOrigin = 'anonymous'
    script.addEventListener('load', handleLoad, { once: true })
    script.addEventListener('error', handleError, { once: true })
    document.head.appendChild(script)
  }).catch((error) => {
    cubism2RuntimePromise = null
    throw error
  })

  return cubism2RuntimePromise
}

interface Props {
  width: number
  height: number
  onHit?: () => void
}

export default function Live2DCanvas({ width, height, onHit }: Props) {
  const canvasHostRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<unknown>(null)
  const canvasViewRef = useRef<HTMLCanvasElement | null>(null)
  const onHitRef = useRef(onHit)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  // Keep ref current so the model listener never goes stale
  useEffect(() => { onHitRef.current = onHit }, [onHit])

  useEffect(() => {
    const canvasHostElement = canvasHostRef.current
    if (!canvasHostElement) return
    const canvasHost = canvasHostElement

    let cancelled = false

    async function init() {
      try {
        await ensureCubism2Runtime()
        if (cancelled) return

        const PIXI = await import('pixi.js')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(window as any).PIXI = PIXI
        const { Live2DModel } = await import('pixi-live2d-display/cubism2')

        if (cancelled) return

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const app = new (PIXI.Application as any)({
          width,
          height,
          backgroundAlpha: 0,
          antialias: true,
          autoDensity: true,
          resolution: window.devicePixelRatio || 1,
        })

        canvasHost.appendChild(app.renderer.view)
        appRef.current = app
        canvasViewRef.current = app.renderer.view

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const model: any = await Live2DModel.from(MODEL_URL, { autoInteract: true })
        if (cancelled) return

        app.stage.addChild(model)

        const scale = Math.min(
          (width * 0.9) / model.internalModel.width,
          (height * 0.95) / model.internalModel.height,
        )
        model.scale.set(scale)
        model.x = (width - model.width) / 2
        model.y = height - model.height

        // Motion on hit — use ref so callback is always fresh
        model.on('hit', (hitAreas: string[]) => {
          const group = hitAreas[0] ? `tap_${hitAreas[0]}` : 'tap_body'
          model.motion(group).catch(() => model.motion('tap_body').catch(() => {}))
          onHitRef.current?.()
        })

        // Fallback: fires onHit on click (desktop) or touchend (mobile).
        // PIXI sets touch-action:none on the canvas, which suppresses synthetic
        // click events from touch — so touchend is needed for mobile.
        const handleInteraction = () => { onHitRef.current?.() }
        app.renderer.view.addEventListener('click', handleInteraction)
        app.renderer.view.addEventListener('touchend', handleInteraction)

        setStatus('ready')
      } catch (err) {
        if (!cancelled) {
          console.error('[Live2D]', err)
          setStatus('error')
        }
      }
    }

    init()

    return () => {
      cancelled = true
      if (appRef.current) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const a = appRef.current as any
        try { a.destroy(false, { children: true }) } catch { /* noop */ }
        appRef.current = null
      }
      const canvasView = canvasViewRef.current
      if (canvasView?.parentNode === canvasHost) {
        canvasHost.removeChild(canvasView)
      }
      canvasViewRef.current = null
    }
  }, [width, height])

  return (
    <div style={{ width, height, position: 'relative', cursor: 'pointer' }}>
      <div ref={canvasHostRef} className="absolute inset-0" />
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-foreground-400">
          加载中…
        </div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-foreground-400 text-center px-4">
          模型加载失败
        </div>
      )}
    </div>
  )
}
