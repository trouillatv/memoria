'use client'

// Fermeture de la liste « À vérifier » (mig 196) — la RÉCONCILIATION au débrief.
// On ne redemande pas tout : seulement les points encore non statués, puis le
// bilan (« 4 proposés · 3 vérifiés · 1 à suivre »). Un « à suivre » peut être
// PROMU manuellement en action ou réserve — jamais automatiquement.

import { useState, useTransition } from 'react'
import { Check, Eye, X, ListChecks, AlertTriangle, ListTodo } from 'lucide-react'
import { toast } from 'sonner'
import { setWatchlistItemStateAction } from '@/app/(field)/m/site/[siteId]/watchlist-actions'
import { promoteWatchlistItemAction } from './debrief-actions'
import type { DbVisitWatchlistItem, WatchlistItemState } from '@/types/db'

export function WatchlistDebrief({ items: initialItems }: { items: DbVisitWatchlistItem[] }) {
  const [items, setItems] = useState(initialItems)
  const [, start] = useTransition()
  if (items.length === 0) return null

  const pending = items.filter((i) => i.state === 'pending')
  const verified = items.filter((i) => i.state === 'verified').length
  const toFollow = items.filter((i) => i.state === 'to_follow')
  const dismissed = items.filter((i) => i.state === 'dismissed').length

  function decide(item: DbVisitWatchlistItem, state: WatchlistItemState) {
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, state } : i)))
    start(async () => {
      const r = await setWatchlistItemStateAction({ item_id: item.id, state })
      if (!r.ok) toast.error(r.error)
    })
  }

  function promote(item: DbVisitWatchlistItem, to: 'action' | 'reserve') {
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, promoted_to: to } : i)))
    start(async () => {
      const r = await promoteWatchlistItemAction({ item_id: item.id, promote_to: to })
      if (r.ok) toast.success(to === 'action' ? 'Action créée' : 'Réserve créée', { duration: 1200 })
      else {
        toast.error(r.error)
        setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, promoted_to: null } : i)))
      }
    })
  }

  const bilan = [
    `${items.length} proposé${items.length > 1 ? 's' : ''}`,
    verified > 0 ? `${verified} vérifié${verified > 1 ? 's' : ''}` : null,
    toFollow.length > 0 ? `${toFollow.length} à suivre` : null,
    dismissed > 0 ? `${dismissed} sans objet` : null,
  ].filter(Boolean).join(' · ')

  return (
    <section className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/40 p-3 dark:border-amber-900/40 dark:bg-amber-950/15" data-testid="watchlist-debrief">
      <div className="space-y-0.5">
        <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold text-amber-900 dark:text-amber-200">
          <ListChecks className="h-4 w-4" /> Ce qu&apos;il fallait vérifier
        </h2>
        <p className="text-[12px] text-amber-800/80 dark:text-amber-200/70">{bilan}</p>
      </div>

      {/* Seulement ce qui reste ouvert — on ne redemande jamais tout. */}
      {pending.map((item) => (
        <div key={item.id} className="space-y-1.5 rounded-lg border bg-background p-2.5">
          <p className="text-sm leading-snug">{item.label}</p>
          <div className="grid grid-cols-3 gap-1.5">
            <button type="button" onClick={() => decide(item, 'verified')} className="inline-flex items-center justify-center gap-1 rounded-lg border px-1 py-2 text-xs font-medium text-emerald-700 active:scale-[0.98]">
              <Check className="h-3.5 w-3.5" /> Vérifié
            </button>
            <button type="button" onClick={() => decide(item, 'to_follow')} className="inline-flex items-center justify-center gap-1 rounded-lg border px-1 py-2 text-xs font-medium text-amber-700 active:scale-[0.98]">
              <Eye className="h-3.5 w-3.5" /> À suivre
            </button>
            <button type="button" onClick={() => decide(item, 'dismissed')} className="inline-flex items-center justify-center gap-1 rounded-lg border px-1 py-2 text-xs font-medium text-muted-foreground active:scale-[0.98]">
              <X className="h-3.5 w-3.5" /> Sans objet
            </button>
          </div>
        </div>
      ))}

      {/* Les « à suivre » : promotion HUMAINE en objet chantier, facultative. */}
      {toFollow.filter((i) => !i.promoted_to).map((item) => (
        <div key={item.id} className="space-y-1.5 rounded-lg border bg-background p-2.5">
          <p className="text-sm leading-snug">
            <Eye className="mr-1 inline h-3.5 w-3.5 text-amber-600" />
            {item.label}
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            <button type="button" onClick={() => promote(item, 'action')} className="inline-flex items-center justify-center gap-1 rounded-lg border px-1 py-2 text-xs font-medium active:scale-[0.98]">
              <ListTodo className="h-3.5 w-3.5" /> En faire une action
            </button>
            <button type="button" onClick={() => promote(item, 'reserve')} className="inline-flex items-center justify-center gap-1 rounded-lg border px-1 py-2 text-xs font-medium active:scale-[0.98]">
              <AlertTriangle className="h-3.5 w-3.5" /> En faire une réserve
            </button>
          </div>
        </div>
      ))}
    </section>
  )
}
