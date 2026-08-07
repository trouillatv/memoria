'use client'

import { useCallback, useRef } from 'react'
import type { ForceGraphEngine } from '@/components/graph/force-graph-engine'
import { fitToContent, zoomEngine, type FitItem } from '@/lib/graph/graph-utils'

export interface GraphCanvasRefs {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  wrapRef: React.RefObject<HTMLDivElement | null>
  engineRef: React.MutableRefObject<ForceGraphEngine | null>
  navigatingRef: React.MutableRefObject<string | null>
  fitToView: (items: FitItem[], padding?: number) => void
  zoomBy: (factor: number) => void
}

export function useGraphCanvas(): GraphCanvasRefs {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<ForceGraphEngine | null>(null)
  const navigatingRef = useRef<string | null>(null)

  const fitToView = useCallback((items: FitItem[], padding?: number) => {
    const engine = engineRef.current
    if (!engine) return
    fitToContent(engine, items, padding)
  }, [])

  const zoomBy = useCallback((factor: number) => {
    const engine = engineRef.current
    if (!engine) return
    zoomEngine(engine, factor)
  }, [])

  return { canvasRef, wrapRef, engineRef, navigatingRef, fitToView, zoomBy }
}
