'use client'

import { useRef, useEffect, useState, useCallback } from 'react'

interface Props {
  onSign: (dataUrl: string) => void
  disabled?: boolean
}

export function SignaturePad({ onSign, disabled }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isEmpty, setIsEmpty] = useState(true)
  const drawing = useRef(false)
  const lastPos = useRef<{ x: number; y: number } | null>(null)

  // Initialise le canvas avec fond blanc et fixe la résolution device pixel
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, rect.width, rect.height)
    ctx.strokeStyle = '#111111'
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
  }, [])

  function getPos(e: React.TouchEvent | React.MouseEvent): { x: number; y: number } | null {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    if ('touches' in e) {
      const touch = e.touches[0]
      if (!touch) return null
      return { x: touch.clientX - rect.left, y: touch.clientY - rect.top }
    }
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top }
  }

  function startDraw(e: React.TouchEvent | React.MouseEvent) {
    if (disabled) return
    e.preventDefault()
    drawing.current = true
    const pos = getPos(e)
    lastPos.current = pos
  }

  function draw(e: React.TouchEvent | React.MouseEvent) {
    if (!drawing.current || disabled) return
    e.preventDefault()
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    const pos = getPos(e)
    if (!ctx || !pos || !lastPos.current) return

    ctx.beginPath()
    ctx.moveTo(lastPos.current.x, lastPos.current.y)
    ctx.lineTo(pos.x, pos.y)
    ctx.stroke()
    lastPos.current = pos
    setIsEmpty(false)
  }

  function endDraw() {
    drawing.current = false
    lastPos.current = null
  }

  const clear = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const rect = canvas.getBoundingClientRect()
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, rect.width, rect.height)
    setIsEmpty(true)
  }, [])

  function confirm() {
    const canvas = canvasRef.current
    if (!canvas || isEmpty) return
    onSign(canvas.toDataURL('image/png'))
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Signez avec votre doigt dans le cadre ci-dessous.</p>
      <div className="relative rounded-xl border-2 border-dashed border-border bg-white overflow-hidden" style={{ height: 180 }}>
        <canvas
          ref={canvasRef}
          className="w-full h-full touch-none cursor-crosshair"
          style={{ display: 'block' }}
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={endDraw}
        />
        {isEmpty && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-xs text-muted-foreground/50 select-none">Zone de signature</span>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={clear}
          disabled={disabled || isEmpty}
          className="text-sm text-muted-foreground underline disabled:opacity-40"
        >
          Effacer
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={disabled || isEmpty}
          className="inline-flex items-center gap-2 rounded-xl bg-foreground text-background text-base font-medium px-5 py-3 active:bg-foreground/90 disabled:opacity-50"
          style={{ minHeight: 52 }}
        >
          Confirmer la signature
        </button>
      </div>
    </div>
  )
}
