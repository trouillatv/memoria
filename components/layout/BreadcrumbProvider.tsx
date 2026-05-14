'use client'

// Provider client qui permet à n'importe quelle page de personnaliser le
// breadcrumb : (1) renommer un segment UUID via DynamicCrumb, (2) injecter
// des crumbs de préfixe via BreadcrumbPrefix pour les routes "plates" qui
// devraient logiquement remonter une hiérarchie (ex. /interventions/[id]
// devrait afficher "Contrats > X > Interventions > Y").
//
// Cycle de vie : tout est nettoyé au démontage du composant qui l'a posé.

import { createContext, useContext, useEffect, useState, useCallback } from 'react'

export interface PrefixCrumb {
  href: string
  label: string
}

interface BreadcrumbCtx {
  labels: Map<string, string>
  setLabel: (id: string, label: string) => void
  clearLabel: (id: string) => void
  prefixCrumbs: PrefixCrumb[]
  setPrefix: (crumbs: PrefixCrumb[]) => void
}

const Ctx = createContext<BreadcrumbCtx | null>(null)

function sameCrumbs(a: PrefixCrumb[], b: PrefixCrumb[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].href !== b[i].href || a[i].label !== b[i].label) return false
  }
  return true
}

export function BreadcrumbProvider({ children }: { children: React.ReactNode }) {
  const [labels, setLabels] = useState<Map<string, string>>(new Map())
  const [prefixCrumbs, setPrefixCrumbs] = useState<PrefixCrumb[]>([])

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
  const setPrefix = useCallback((crumbs: PrefixCrumb[]) => {
    setPrefixCrumbs((prev) => (sameCrumbs(prev, crumbs) ? prev : crumbs))
  }, [])

  return (
    <Ctx.Provider value={{ labels, setLabel, clearLabel, prefixCrumbs, setPrefix }}>
      {children}
    </Ctx.Provider>
  )
}

export function useBreadcrumbLabels(): ReadonlyMap<string, string> {
  const ctx = useContext(Ctx)
  return ctx?.labels ?? new Map()
}

export function useBreadcrumbPrefix(): readonly PrefixCrumb[] {
  const ctx = useContext(Ctx)
  return ctx?.prefixCrumbs ?? []
}

/**
 * Composant invisible qui enregistre un label pour un segment UUID donné.
 * À placer dans une page : `<DynamicCrumb segmentId={c.id} label={c.name} />`
 */
export function DynamicCrumb({ segmentId, label }: { segmentId: string; label: string }) {
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

/**
 * Composant invisible qui injecte des crumbs de préfixe (rendus AVANT le
 * pathname). Utile pour les routes plates comme /interventions/[id] qui
 * devraient logiquement remonter un contexte parent (Contrats > X).
 *
 * Usage :
 *   <BreadcrumbPrefix crumbs={[
 *     { href: '/contracts', label: 'Contrats' },
 *     { href: `/contracts/${id}/interventions`, label: contractName },
 *   ]} />
 */
export function BreadcrumbPrefix({ crumbs }: { crumbs: PrefixCrumb[] }) {
  const ctx = useContext(Ctx)
  const setPrefix = ctx?.setPrefix
  useEffect(() => {
    if (!setPrefix) return
    setPrefix(crumbs)
    return () => setPrefix([])
    // crumbs est sérialisable mais peut changer à chaque render — on
    // s'appuie sur sameCrumbs côté provider pour éviter le rerender.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setPrefix, JSON.stringify(crumbs)])
  return null
}
