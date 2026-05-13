'use client'

// Provider client qui permet à n'importe quelle page de RENSEIGNER le label
// affiché par le breadcrumb pour un segment UUID donné.
//
// Usage côté page :
//   <DynamicCrumb segmentId={contract.id} label={contract.name} />
//
// Le Breadcrumb lit ces labels en premier, puis fallback sur LABELS statiques,
// puis sur le segment brut. Cycle de vie : labels persistent tant que le
// composant <DynamicCrumb> est monté (donc tant qu'on est sur la page).

import { createContext, useContext, useEffect, useState, useCallback } from 'react'

interface BreadcrumbCtx {
  labels: Map<string, string>
  setLabel: (id: string, label: string) => void
  clearLabel: (id: string) => void
}

const Ctx = createContext<BreadcrumbCtx | null>(null)

export function BreadcrumbProvider({ children }: { children: React.ReactNode }) {
  const [labels, setLabels] = useState<Map<string, string>>(new Map())
  const setLabel = useCallback((id: string, label: string) => {
    setLabels((prev) => {
      if (prev.get(id) === label) return prev
      const next = new Map(prev)
      next.set(id, label)
      return next
    })
  }, [])
  const clearLabel = useCallback((id: string) => {
    setLabels((prev) => {
      if (!prev.has(id)) return prev
      const next = new Map(prev)
      next.delete(id)
      return next
    })
  }, [])
  return <Ctx.Provider value={{ labels, setLabel, clearLabel }}>{children}</Ctx.Provider>
}

export function useBreadcrumbLabels(): ReadonlyMap<string, string> {
  const ctx = useContext(Ctx)
  return ctx?.labels ?? new Map()
}

/**
 * Composant invisible qui enregistre un label pour un segment UUID donné.
 * À placer dans une page server/client : `<DynamicCrumb segmentId={c.id} label={c.name} />`
 */
export function DynamicCrumb({ segmentId, label }: { segmentId: string; label: string }) {
  // On déstructure setLabel/clearLabel (stables via useCallback) au lieu de
  // dépendre de `ctx`, qui est un objet recréé à chaque render du Provider
  // (sinon : setLabel → labels change → ctx change → effect re-fire → loop).
  const ctx = useContext(Ctx)
  const setLabel = ctx?.setLabel
  const clearLabel = ctx?.clearLabel
  useEffect(() => {
    if (!setLabel || !clearLabel) return
    setLabel(segmentId, label)
    return () => clearLabel(segmentId)
  }, [setLabel, clearLabel, segmentId, label])
  return null
}
