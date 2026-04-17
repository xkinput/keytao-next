'use client'

import { useEffect, useRef, useState } from 'react'

const MODEL_URL =
  process.env.NEXT_PUBLIC_LIVE2D_MODEL ||
  'https://cdn.jsdelivr.net/npm/live2d-widget-model-shizuku@1.0.5/assets/shizuku.model.json'

interface Props {
  width: number
  height: number
  onHit?: () => void
}

export default function Live2DCanvas({ width, height, onHit }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<unknown>(null)
  const onHitRef = useRef(onHit)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  // Keep ref current so the model listener never goes stale
  useEffect(() => { onHitRef.current = onHit }, [onHit])

  useEffect(() => {
    if (!containerRef.current) return
    let cancelled = false

    async function init() {
      try {
        const PIXI = await import('pixi.js')
        const { Live2DModel } = await import('pixi-live2d-display/cubism2')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(window as any).PIXI = PIXI

        if (cancelled || !containerRef.current) return

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const app = new (PIXI.Application as any)({
          width,
          height,
          backgroundAlpha: 0,
          antialias: true,
          autoDensity: true,
          resolution: window.devicePixelRatio || 1,
        })

        containerRef.current.appendChild(app.renderer.view)
        appRef.current = app

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
        try { a.destroy(true, { children: true }) } catch { /* noop */ }
        appRef.current = null
      }
      if (containerRef.current) {
        while (containerRef.current.firstChild) {
          containerRef.current.removeChild(containerRef.current.firstChild)
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height])

  return (
    <div ref={containerRef} style={{ width, height, position: 'relative', cursor: 'pointer' }}>
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
