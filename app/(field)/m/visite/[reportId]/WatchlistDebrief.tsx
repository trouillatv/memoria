'use client'

// Fermeture du plan de visite (mig 196/255) — la RÉCONCILIATION au débrief.
// On ne redemande pas tout : seulement les points encore non statués, puis le
// bilan (« 4 points · 3 conformes · 1 toujours ouvert »). Un « toujours ouvert »
// peut être PROMU manuellement en action ou réserve — jamais automatiquement.
// mig 254 : criticité visible (rouge = irréversible, amber = retard).
// mig 255 : états sémantiques (checked / still_open / not_applicable) + commentaire
//   facultatif sur un point toujours ouvert (nourrit le débrief automatiquement).

import { useState, useTransition } from 'react'
import { Check, Eye, X, ListChecks, AlertTriangle, ListTodo } from 'lucide-react'
import { toast } from 'sonner'
import { setWatchlistItemStateAction, submitPlanVisiteVerdictAction } from '@/app/(field)/m/site/[siteId]/watchlist-actions'
import { promoteWatchlistItemAction } from './debrief-actions'
import { planVisiteVerdictOptions, verdictForWatchlistState, watchlistStateForVerdict, type PlanVisiteVerdict } from '@/lib/visits/plan-visite-verdict'
import { PlanVisiteVerdictButtons } from '@/components/field/PlanVisiteVerdictButtons'
import type { DbVisitWatchlistItem, WatchlistItemPriority } from '@/types/db'

type LegacyWatchlistState = 'pending' | 'checked' | 'still_open' | 'not_applicable'

const PRIORITY_DOT: Record<WatchlistItemPriority, string | null> = {
  critical: 'bg-red-500',
  important: 'bg-amber-500',
  normal: null,
}

export function WatchlistDebrief({ items: initialItems }: { items: DbVisitWatchlistItem[] }) {
  const [items, setItems] = useState(initialItems)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [, start] = useTransition()
  if (items.length === 0) return null

  const pending = items.filter((i) => i.state === 'pending')
  const checked = items.filter((i) => i.state === 'checked').length
  const stillOpen = items.filter((i) => i.state === 'still_open')
  const notApplicable = items.filter((i) => i.state === 'not_applicable').length
  const notApplicableVisit = items.filter((i) => i.state === 'not_applicable_visit').length
  const dismissedPermanently = items.filter((i) => i.state === 'dismissed_permanently').length

  function decide(item: DbVisitWatchlistItem, state: LegacyWatchlistState, note?: string) {
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, state, note: note ?? i.note } : i)))
    start(async () => {
      const r = await setWatchlistItemStateAction({ item_id: item.id, state, note })
      if (!r.ok) toast.error(r.error)
    })
  }

  // Points à source structurée : verdict métier routé par l'orchestrateur, la
  // mutation de la source précède l'écriture watchlist (cf. VisitBasket).
  function decidePlanVisite(item: DbVisitWatchlistItem, verdict: PlanVisiteVerdict, comment: string | null) {
    return submitPlanVisiteVerdictAction({
      item_id: item.id,
      report_id: item.report_id,
      site_id: item.site_id,
      verdict,
      comment: comment ?? undefined,
    })
  }
  function onPlanVisiteSuccess(item: DbVisitWatchlistItem, verdict: PlanVisiteVerdict) {
    const state = watchlistStateForVerdict(verdict)
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, state } : i)))
  }

  function saveNote(item: DbVisitWatchlistItem) {
    const note = notes[item.id]?.trim() || undefined
    if (!note && !item.note) return
    start(async () => {
      const r = await setWatchlistItemStateAction({ item_id: item.id, state: 'still_open', note })
      if (r.ok) setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, note: note ?? null } : i)))
      else toast.error(r.error)
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
    `${items.length} point${items.length > 1 ? 's' : ''}`,
    checked > 0 ? `${checked} positif${checked > 1 ? 's' : ''}` : null,
    stillOpen.length > 0 ? `${stillOpen.length} toujours ouvert${stillOpen.length > 1 ? 's' : ''}` : null,
    notApplicableVisit > 0 ? `${notApplicableVisit} sans objet pour cette visite` : null,
    notApplicable > 0 ? `${notApplicable} sans objet` : null,
    dismissedPermanently > 0 ? `${dismissedPermanently} ne plus suivre` : null,
  ].filter(Boolean).join(' · ')

  return (
    <section className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/40 p-3 dark:border-amber-900/40 dark:bg-amber-950/15" data-testid="watchlist-debrief">
      <div className="space-y-0.5">
        <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold text-amber-900 dark:text-amber-200">
          <ListChecks className="h-4 w-4" /> Plan de visite
        </h2>
        <p className="text-[12px] text-amber-800/80 dark:text-amber-200/70">{bilan}</p>
      </div>

      {/* Seulement ce qui reste ouvert — on ne redemande jamais tout. */}
      {pending.map((item) => {
        const dot = PRIORITY_DOT[item.priority ?? 'normal']
        return (
          <div key={item.id} className="space-y-1.5 rounded-lg border bg-background p-2.5">
            <div className="flex items-start gap-2">
              {dot && <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot}`} />}
              <span className="text-sm leading-snug">{item.label}</span>
            </div>
            {item.reason && (
              <p className="text-[11px] leading-snug text-muted-foreground pl-4">{item.reason}</p>
            )}
            {(() => {
              const options = planVisiteVerdictOptions(item.source_kind)
              if (options.length > 0) {
                return (
                  <PlanVisiteVerdictButtons
                    sourceKind={item.source_kind as string}
                    options={options}
                    activeVerdict={verdictForWatchlistState(item.state)}
                    onSubmit={(verdict, comment) => decidePlanVisite(item, verdict, comment)}
                    onSuccess={(verdict) => onPlanVisiteSuccess(item, verdict)}
                    onError={(message) => toast.error(message)}
                  />
                )
              }
              return (
                <div className="grid grid-cols-3 gap-1.5">
                  <button type="button" onClick={() => decide(item, 'checked')} className="inline-flex items-center justify-center gap-1 rounded-lg border px-1 py-2 text-xs font-medium text-emerald-700 active:scale-[0.98]">
                    <Check className="h-3.5 w-3.5" /> Conforme
                  </button>
                  <button type="button" onClick={() => decide(item, 'still_open')} className="inline-flex items-center justify-center gap-1 rounded-lg border px-1 py-2 text-xs font-medium text-amber-700 active:scale-[0.98]">
                    <Eye className="h-3.5 w-3.5" /> Toujours ouvert
                  </button>
                  <button type="button" onClick={() => decide(item, 'not_applicable')} className="inline-flex items-center justify-center gap-1 rounded-lg border px-1 py-2 text-xs font-medium text-muted-foreground active:scale-[0.98]">
                    <X className="h-3.5 w-3.5" /> Sans objet
                  </button>
                </div>
              )
            })()}
          </div>
        )
      })}

      {/* Points toujours ouverts : commentaire facultatif + promotion HUMAINE. */}
      {stillOpen.filter((i) => !i.promoted_to).map((item) => (
        <div key={item.id} className="space-y-2 rounded-lg border bg-background p-2.5">
          <p className="text-sm leading-snug">
            <Eye className="mr-1 inline h-3.5 w-3.5 text-amber-600" />
            {item.label}
          </p>
          {/* Commentaire court — nourrira le CR automatiquement (Sprint 3). */}
          <div className="flex gap-1.5">
            <input
              type="text"
              value={notes[item.id] ?? item.note ?? ''}
              onChange={(e) => setNotes((p) => ({ ...p, [item.id]: e.target.value }))}
              onBlur={() => saveNote(item)}
              placeholder="Observation (facultatif)…"
              maxLength={300}
              className="w-full rounded-lg border border-input bg-muted/30 px-2.5 py-1.5 text-[13px] focus:outline-none focus:ring-1 focus:ring-amber-400"
            />
          </div>
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
