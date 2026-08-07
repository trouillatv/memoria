'use client'

import { useCallback, useRef } from 'react'
import type { ForceGraphEngine } from '@/components/graph/force-graph-engine'
import { fitToContent, fitToContentAnimated, zoomEngine, type FitItem } from '@/lib/graph/graph-utils'

export interface GraphCanvasRefs {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  wrapRef: React.RefObject<HTMLDivElement | null>
  engineRef: React.MutableRefObject<ForceGraphEngine | null>
  navigatingRef: React.MutableRefObject<string | null>
  fitToView: (items: FitItem[], padding?: number) => void
  /** Anime la caméra vers les nœuds visibles (alpha > 0.5). Caméra seule, aucune physique. */
  fitVisibleAnimated: (items: FitItem[], padding?: number) => void
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

  const fitVisibleAnimated = useCallback((items: FitItem[], padding = 20) => {
    const engine = engineRef.current
    if (!engine) return
    const visible = items.filter(({ id }) => (engine.P[id]?.alpha ?? 0) > 0.5)
    if (visible.length === 0) return
    fitToContentAnimated(engine, visible, padding, 200)
  }, [])

  const zoomBy = useCallback((factor: number) => {
    const engine = engineRef.current
    if (!engine) return
    zoomEngine(engine, factor)
  }, [])

  return { canvasRef, wrapRef, engineRef, navigatingRef, fitToView, fitVisibleAnimated, zoomBy }
}
