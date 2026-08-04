'use client'

import { useOptimistic, useTransition } from 'react'
import { Plus, Check, X, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { addToPlanAction, removeFromPlanAction } from './brief-actions'
import type { PvAttentionItem, PvVerifyItem } from '@/lib/knowledge/site-overview'

const REASON_LABEL: Record<string, string> = {
  non_conforme: 'Non conforme',
  'aggravé':    'Aggravé',
  'réouvert':   'Réouvert',
  sans_évolution: 'Sans évolution',
}

const PRIORITY_DOT: Record<string, string> = {
  critical:  'bg-rose-500',
  important: 'bg-amber-400',
  normal:    'bg-sky-400',
}

type SelectionMap = Map<string, string> // stable_key → prep item id

// ── Depuis le dernier PV ─────────────────────────────────────────────────────

export interface PvLastDeltaProps {
  fromDate: string
  toDate: string
  nouveaux: number
  aggravésRéouverts: number
  réalisésLevés: number
}

export function DeltaBlock({ delta }: { delta: PvLastDeltaProps }) {
  const from = new Date(delta.fromDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
  const to   = new Date(delta.toDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })

  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Depuis le PV du {from}
      </h2>
      <div className="flex flex-wrap gap-3 rounded-2xl border border-foreground/[0.06] bg-card px-4 py-3 text-[13px]">
        {delta.nouveaux > 0 && (
          <span className="text-foreground font-medium">
            <span className="text-rose-600 font-bold">{delta.nouveaux}</span> nouveau{delta.nouveaux > 1 ? 'x' : ''}
          </span>
        )}
        {delta.aggravésRéouverts > 0 && (
          <span className="text-foreground font-medium">
            <span className="text-amber-600 font-bold">{delta.aggravésRéouverts}</span> aggravé{delta.aggravésRéouverts > 1 ? 's' : ''}
          </span>
        )}
        {delta.réalisésLevés > 0 && (
          <span className="text-foreground font-medium">
            <span className="text-emerald-600 font-bold">{delta.réalisésLevés}</span> traité{delta.réalisésLevés > 1 ? 's' : ''}
          </span>
        )}
        {delta.nouveaux === 0 && delta.aggravésRéouverts === 0 && delta.réalisésLevés === 0 && (
          <span className="text-muted-foreground">Aucun changement</span>
        )}
        <span className="text-muted-foreground ml-auto text-[11px]">jusqu'au {to}</span>
      </div>
    </section>
  )
}

// ── Priorités proposées ───────────────────────────────────────────────────────

interface AttentionRowProps {
  item: PvAttentionItem
  siteId: string
  stableKey: string
  selected: boolean
  prepItemId: string | null
  onToggle: (item: PvAttentionItem, stableKey: string, selected: boolean, prepItemId: string | null) => void
}

function AttentionRow({ item, siteId, stableKey, selected, prepItemId, onToggle }: AttentionRowProps) {
  return (
    <li className="flex items-start gap-3 rounded-2xl border border-foreground/[0.08] bg-card px-3 py-3">
      <div className="mt-1.5 shrink-0">
        <span className={`block h-2 w-2 rounded-full ${item.reason === 'non_conforme' || item.reason === 'aggravé' ? 'bg-rose-500' : 'bg-amber-400'}`} />
      </div>
      <div className="min-w-0 flex-1 space-y-0.5">
        {item.href ? (
          <a href={item.href} className="block text-[13.5px] font-medium leading-snug hover:underline">
            {item.label}
          </a>
        ) : (
          <p className="text-[13.5px] font-medium leading-snug">{item.label}</p>
        )}
        <p className="text-[11.5px] text-muted-foreground">
          {REASON_LABEL[item.reason] ?? item.reason}
          {item.pvCount > 1 && ` · ${item.pvCount} PV`}
        </p>
      </div>
      <button
        type="button"
        onClick={() => onToggle(item, stableKey, selected, prepItemId)}
        className={`shrink-0 rounded-xl px-2.5 py-1.5 text-[11.5px] font-medium transition-colors ${
          selected
            ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800'
            : 'bg-muted text-muted-foreground ring-1 ring-border hover:bg-muted/80'
        }`}
      >
        {selected ? <><Check className="mr-0.5 inline h-3 w-3" /> Dans mon plan</> : <><Plus className="mr-0.5 inline h-3 w-3" /> Ajouter</>}
      </button>
    </li>
  )
}

// ── Sujets à garder en tête ───────────────────────────────────────────────────

interface VerifyRowProps {
  item: PvVerifyItem
  stableKey: string
  selected: boolean
  prepItemId: string | null
  onToggle: (item: PvVerifyItem, stableKey: string, selected: boolean, prepItemId: string | null) => void
}

function VerifyRow({ item, stableKey, selected, prepItemId, onToggle }: VerifyRowProps) {
  return (
    <li className="flex items-start gap-3 rounded-2xl border border-foreground/[0.08] bg-card px-3 py-3">
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center gap-2">
          <p className="text-[13.5px] font-medium leading-snug">{item.label}</p>
          {item.href && (
            <a href={item.href} className="shrink-0 text-muted-foreground hover:text-foreground">
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
        {item.signals.length > 0 && (
          <p className="text-[11.5px] text-muted-foreground">{item.signals.slice(0, 2).join(' · ')}</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => onToggle(item, stableKey, selected, prepItemId)}
        className={`shrink-0 rounded-xl px-2.5 py-1.5 text-[11.5px] font-medium transition-colors ${
          selected
            ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800'
            : 'bg-muted text-muted-foreground ring-1 ring-border hover:bg-muted/80'
        }`}
      >
        {selected ? <><Check className="mr-0.5 inline h-3 w-3" /> Dans mon plan</> : <><Plus className="mr-0.5 inline h-3 w-3" /> Ajouter</>}
      </button>
    </li>
  )
}

// ── Composant racine ──────────────────────────────────────────────────────────

export interface PrepItemSeed {
  id: string
  stableKey: string
  label: string
  sourceKind: 'auto_attention' | 'auto_verify' | 'auto_important' | 'manual'
  sourceRef: string | null
  canonicalSubjectId: string | null
  priority: 'critical' | 'important' | 'normal'
  reason: string | null
}

export interface VisitBriefClientProps {
  siteId: string
  pvAttention: PvAttentionItem[]
  pvToVerify:  PvVerifyItem[]
  initialPrepItems: PrepItemSeed[]
}

export function VisitBriefClient({
  siteId,
  pvAttention,
  pvToVerify,
  initialPrepItems,
}: VisitBriefClientProps) {
  const [, startTransition] = useTransition()

  // Optimistic state : stable_key → prep item id (null quand pas encore persisté)
  const [selMap, setSelMap] = useOptimistic<SelectionMap>(
    new Map(initialPrepItems.map((p) => [p.stableKey, p.id])),
  )

  const planCount = selMap.size

  function toggleAttention(item: PvAttentionItem, stableKey: string, isSelected: boolean, prepItemId: string | null) {
    startTransition(async () => {
      if (isSelected && prepItemId) {
        setSelMap((prev) => { const m = new Map(prev); m.delete(stableKey); return m })
        const res = await removeFromPlanAction({ id: prepItemId, site_id: siteId })
        if (!res.ok) { toast.error(res.error); setSelMap((prev) => new Map(prev).set(stableKey, prepItemId)) }
      } else {
        // Optimiste : on génère un id temporaire
        const tempId = `tmp-${stableKey}`
        setSelMap((prev) => new Map(prev).set(stableKey, tempId))
        const res = await addToPlanAction({
          site_id: siteId,
          stable_key: stableKey,
          label: item.label,
          source_kind: 'auto_attention',
          source_ref: item.canonicalSubjectId,
          canonical_subject_id: item.canonicalSubjectId,
          priority: item.reason === 'non_conforme' || item.reason === 'aggravé' ? 'important' : 'normal',
          reason: REASON_LABEL[item.reason] ?? item.reason,
        })
        if (!res.ok) { toast.error(res.error); setSelMap((prev) => { const m = new Map(prev); m.delete(stableKey); return m }) }
      }
    })
  }

  function toggleVerify(item: PvVerifyItem, stableKey: string, isSelected: boolean, prepItemId: string | null) {
    startTransition(async () => {
      if (isSelected && prepItemId) {
        setSelMap((prev) => { const m = new Map(prev); m.delete(stableKey); return m })
        const res = await removeFromPlanAction({ id: prepItemId, site_id: siteId })
        if (!res.ok) { toast.error(res.error); setSelMap((prev) => new Map(prev).set(stableKey, prepItemId)) }
      } else {
        const tempId = `tmp-${stableKey}`
        setSelMap((prev) => new Map(prev).set(stableKey, tempId))
        const signalText = item.signals.slice(0, 2).join(' · ') || null
        const res = await addToPlanAction({
          site_id: siteId,
          stable_key: stableKey,
          label: item.label,
          source_kind: 'auto_verify',
          source_ref: item.canonicalSubjectId,
          canonical_subject_id: item.canonicalSubjectId,
          priority: 'normal',
          reason: signalText,
        })
        if (!res.ok) { toast.error(res.error); setSelMap((prev) => { const m = new Map(prev); m.delete(stableKey); return m }) }
      }
    })
  }

  const selectedLabels = initialPrepItems.filter((p) => selMap.has(p.stableKey)).map((p) => p.label)

  return (
    <div className="space-y-5">
      {/* Priorités proposées par MemorIA */}
      {pvAttention.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Priorités proposées
          </h2>
          <ul className="space-y-1.5">
            {pvAttention.slice(0, 5).map((item) => {
              const sk = `attention:${item.canonicalSubjectId ?? item.label}`
              return (
                <AttentionRow
                  key={sk}
                  item={item}
                  siteId={siteId}
                  stableKey={sk}
                  selected={selMap.has(sk)}
                  prepItemId={selMap.get(sk) ?? null}
                  onToggle={toggleAttention}
                />
              )
            })}
          </ul>
        </section>
      )}

      {/* Sujets à garder en tête */}
      {pvToVerify.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Sujets à garder en tête
          </h2>
          <ul className="space-y-1.5">
            {pvToVerify.slice(0, 3).map((item) => {
              const sk = `verify:${item.canonicalSubjectId}`
              return (
                <VerifyRow
                  key={sk}
                  item={item}
                  stableKey={sk}
                  selected={selMap.has(sk)}
                  prepItemId={selMap.get(sk) ?? null}
                  onToggle={toggleVerify}
                />
              )
            })}
          </ul>
        </section>
      )}

      {/* Mon plan de visite */}
      {planCount > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Mon plan · {planCount} point{planCount > 1 ? 's' : ''}
          </h2>
          <ul className="space-y-1 rounded-2xl border border-emerald-200 bg-emerald-50/50 px-3 py-2 dark:border-emerald-900/40 dark:bg-emerald-950/20">
            {initialPrepItems
              .filter((p) => selMap.has(p.stableKey))
              .map((p) => (
                <li key={p.stableKey} className="flex items-center gap-2 py-0.5 text-[13px]">
                  <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                  <span className="min-w-0 truncate font-medium">{p.label}</span>
                </li>
              ))}
          </ul>
        </section>
      )}
    </div>
  )
}

// Export du planCount pour le passer à VisitLauncher via Server Component parent
export { }
export type { SelectionMap }
