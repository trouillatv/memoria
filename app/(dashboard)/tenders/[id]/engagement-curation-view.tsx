'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2, Edit3, X, Check } from 'lucide-react'
import { toast } from 'sonner'
import { StatusBadge } from '@/components/ui/status-badge'
import {
  curateEngagementAction,
  rejectEngagementsAction,
} from './engagements-actions'
import type { DbEngagement, EngagementCategory, EngagementKind, EngagementProofRequirement, EngagementDestination } from '@/types/db'
import { DESTINATION_META } from '@/lib/engagements/destination'
import { CATEGORY_LABELS } from '@/lib/engagements/labels'
import { KIND_META, KIND_ORDER, kindLabel } from '@/lib/engagements/kind'

const CATEGORIES: EngagementCategory[] = [
  'frequency', 'quality', 'compliance', 'delivery', 'sla', 'reporting', 'other',
]

const KINDS: EngagementKind[] = ['objectif', 'obligation', 'livrable', 'controle', 'penalite']

const NEUTRAL_BADGE = 'border-slate-300 bg-slate-50 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300'

interface RenderGroup { id: string; label: string; description: string | null; badge: string; items: DbEngagement[] }

// Sprint 2 — regroupement par NATURE : pénalités et contrôles d'abord (ce qui fait
// perdre / ce qui se prouve), objectifs en dernier, non typés à la fin.
function groupsByKind(engagements: DbEngagement[]): RenderGroup[] {
  const out: RenderGroup[] = []
  for (const kind of KIND_ORDER) {
    const items = engagements.filter((e) => e.kind === kind)
    if (items.length) out.push({ id: kind, label: KIND_META[kind].short, description: KIND_META[kind].description, badge: KIND_META[kind].badge, items })
  }
  const untyped = engagements.filter((e) => !e.kind)
  if (untyped.length) out.push({ id: 'untyped', label: 'Non typé', description: null, badge: 'border-muted bg-muted/40 text-muted-foreground', items: untyped })
  return out
}

// Sprint 3 — regroupement par THÈME (la category : Qualité, Conformité, Reporting…).
// Axe complémentaire à la nature : « l'utilisateur pense aussi en thèmes ».
const CATEGORY_ORDER: EngagementCategory[] = ['quality', 'compliance', 'reporting', 'frequency', 'delivery', 'sla', 'other']
function groupsByCategory(engagements: DbEngagement[]): RenderGroup[] {
  const out: RenderGroup[] = []
  for (const cat of CATEGORY_ORDER) {
    const items = engagements.filter((e) => e.category === cat)
    if (items.length) out.push({ id: cat, label: CATEGORY_LABELS[cat], description: null, badge: NEUTRAL_BADGE, items })
  }
  return out
}

// Destinations proposables à la curation en V1 (a_savoir/mission = à la conversion).
const CURATION_DESTINATIONS: EngagementDestination[] = ['contract_engagement', 'vigilance', 'a_savoir']

/** Réf. source affichable (page / section) depuis le jsonb source_ref. */
function sourceRefLabel(ref: Record<string, unknown> | null): string {
  if (!ref) return ''
  const parts: string[] = []
  if (ref.page != null) parts.push(`p. ${ref.page}`)
  if (ref.section != null) parts.push(`§ ${ref.section}`)
  return parts.join(' · ')
}

export function EngagementCurationView({ engagements }: { engagements: DbEngagement[] }) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [groupMode, setGroupMode] = useState<'kind' | 'category'>('kind')
  const groups = groupMode === 'kind' ? groupsByKind(engagements) : groupsByCategory(engagements)

  const editableCount = engagements.filter((e) => e.status === 'extracted' || e.status === 'curated').length

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAll(extractedOnly: boolean = true) {
    setSelected(new Set(
      engagements
        .filter((e) => !extractedOnly || e.status === 'extracted')
        .map((e) => e.id)
    ))
  }

  function clearSelection() {
    setSelected(new Set())
  }

  async function rejectSelected() {
    if (selected.size === 0) return
    const fd = new FormData()
    fd.set('ids', Array.from(selected).join(','))
    startTransition(async () => {
      const r = await rejectEngagementsAction(fd)
      if (r && 'error' in r && r.error) {
        toast.error(r.error)
      } else {
        toast.success(`${selected.size} engagement${selected.size > 1 ? 's' : ''} supprimé${selected.size > 1 ? 's' : ''}`)
        clearSelection()
        router.refresh()
      }
    })
  }

  async function saveEdit(
    id: string,
    patch: { short_label?: string; category?: EngagementCategory; proof_requirement?: EngagementProofRequirement; destination?: EngagementDestination }
  ) {
    const fd = new FormData()
    fd.set('id', id)
    if (patch.short_label !== undefined) fd.set('short_label', patch.short_label)
    if (patch.category !== undefined) fd.set('category', patch.category)
    if (patch.proof_requirement !== undefined) fd.set('proof_requirement', patch.proof_requirement)
    if (patch.destination !== undefined) fd.set('destination', patch.destination)
    startTransition(async () => {
      const r = await curateEngagementAction(fd)
      if (r && 'error' in r && r.error) {
        toast.error(r.error)
      } else {
        toast.success('Engagement mis à jour')
        setEditing(null)
        router.refresh()
      }
    })
  }

  return (
    <div className="space-y-3">
      {/* Sticky bulk action bar — visible only when selection > 0 */}
      {selected.size > 0 && (
        <div className="sticky top-2 z-10 flex items-center justify-between gap-3 p-2.5 rounded-lg border border-amber-200 bg-amber-50 shadow-sm">
          <span className="text-sm font-medium">
            {selected.size} engagement{selected.size > 1 ? 's' : ''} sélectionné{selected.size > 1 ? 's' : ''}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={clearSelection}
              disabled={pending}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded border bg-card hover:bg-muted/50 text-xs disabled:opacity-50"
            >
              <X className="h-3 w-3" /> Annuler
            </button>
            <button
              type="button"
              onClick={rejectSelected}
              disabled={pending}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-rose-300 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs disabled:opacity-50"
            >
              <Trash2 className="h-3 w-3" /> Supprimer
            </button>
          </div>
        </div>
      )}

      {/* Header bulk actions */}
      {editableCount > 0 && selected.size === 0 && (
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={() => selectAll(true)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Tout sélectionner ({editableCount})
          </button>
        </div>
      )}

      {/* Bascule de regroupement : par NATURE (Sprint 2) ou par THÈME (Sprint 3). */}
      <div className="flex items-center gap-1 text-[11px]">
        <span className="text-muted-foreground mr-1">Grouper par</span>
        {(['kind', 'category'] as const).map((m) => (
          <button key={m} type="button" onClick={() => setGroupMode(m)}
            className={`rounded-full border px-2 py-0.5 font-medium transition-colors ${groupMode === m ? 'border-foreground bg-foreground text-background' : 'hover:bg-muted/50'}`}>
            {m === 'kind' ? 'Nature' : 'Thème'}
          </button>
        ))}
      </div>

      {/* Regroupé selon le mode choisi. */}
      {groups.map((group) => (
        <section key={group.id} className="space-y-2">
          <div className="flex items-center gap-2 pt-1">
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${group.badge}`}>
              {group.label} ({group.items.length})
            </span>
            {group.description && (
              <span className="text-[11px] text-muted-foreground">{group.description}</span>
            )}
          </div>

          <ul className="space-y-2">
            {group.items.map((e) => {
              const isEditable = e.status === 'extracted' || e.status === 'curated'
              const isEditing = editing === e.id
              const isSelected = selected.has(e.id)
              return (
                <li
                  key={e.id}
                  className={`rounded-lg border p-3 bg-card flex items-start gap-3 transition-colors ${
                    isSelected ? 'border-amber-300 bg-amber-50/30' : ''
                  }`}
                >
                  {isEditable && !isEditing && (
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(e.id)}
                      className="mt-1 shrink-0"
                      aria-label={`Sélectionner ${e.short_label}`}
                    />
                  )}

                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      <EditForm
                        engagement={e}
                        pending={pending}
                        onSave={(p) => saveEdit(e.id, p)}
                        onCancel={() => setEditing(null)}
                      />
                    ) : (
                      <>
                        <div className="flex items-center gap-2 mb-1">
                          {e.kind && (
                            <span
                              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${KIND_META[e.kind].badge}`}
                              title="Nature de l'engagement — modifiable à l'édition"
                            >
                              {KIND_META[e.kind].label}
                            </span>
                          )}
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${DESTINATION_META[e.destination].badge}`}
                            title="Destination proposée — modifiable à l'édition"
                          >
                            {DESTINATION_META[e.destination].label}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            conf. {e.ai_confidence?.toFixed(2) ?? '—'}
                          </span>
                          {e.status !== 'extracted' && (
                            <span className="ml-auto">
                              <StatusBadge status={e.status} />
                            </span>
                          )}
                        </div>
                        <div className="text-sm font-semibold mb-1">{e.short_label}</div>
                        <div className="text-xs text-muted-foreground italic">« {e.source_excerpt} »</div>
                        {sourceRefLabel(e.source_ref) && (
                          <div className="text-[10px] text-muted-foreground/80 mt-0.5">
                            source : {sourceRefLabel(e.source_ref)}
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {isEditable && !isEditing && (
                    <button
                      type="button"
                      onClick={() => setEditing(e.id)}
                      className="p-1 rounded hover:bg-muted/50 shrink-0 text-muted-foreground"
                      aria-label="Éditer"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}

const PROOF_REQUIREMENT_LABELS: Record<EngagementProofRequirement, string> = {
  none: 'Aucune preuve requise',
  photo: 'Photo obligatoire',
  anomaly_documented: 'Anomalie documentée',
}

function EditForm({
  engagement,
  pending,
  onSave,
  onCancel,
}: {
  engagement: DbEngagement
  pending: boolean
  onSave: (patch: { short_label?: string; category?: EngagementCategory; kind?: EngagementKind; proof_requirement?: EngagementProofRequirement; destination?: EngagementDestination }) => void
  onCancel: () => void
}) {
  const [label, setLabel] = useState(engagement.short_label)
  const [category, setCategory] = useState<EngagementCategory>(engagement.category)
  const [kind, setKind] = useState<EngagementKind>(engagement.kind ?? 'obligation')
  const [proofReq, setProofReq] = useState<EngagementProofRequirement>(engagement.proof_requirement)
  const [destination, setDestination] = useState<EngagementDestination>(engagement.destination)

  function submit() {
    const patch: { short_label?: string; category?: EngagementCategory; kind?: EngagementKind; proof_requirement?: EngagementProofRequirement; destination?: EngagementDestination } = {}
    if (label !== engagement.short_label) patch.short_label = label
    if (category !== engagement.category) patch.category = category
    if (kind !== (engagement.kind ?? 'obligation')) patch.kind = kind
    if (proofReq !== engagement.proof_requirement) patch.proof_requirement = proofReq
    if (destination !== engagement.destination) patch.destination = destination
    if (Object.keys(patch).length === 0) {
      onCancel()
      return
    }
    onSave(patch)
  }

  return (
    <div className="space-y-2">
      <input
        value={label}
        onChange={(ev) => setLabel(ev.target.value)}
        className="w-full rounded border p-1.5 text-sm"
        placeholder="Label court (3-100 caractères)"
        maxLength={100}
        disabled={pending}
      />
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={kind}
          onChange={(ev) => setKind(ev.target.value as EngagementKind)}
          className="rounded border p-1 text-xs"
          disabled={pending}
          title="Nature de l'engagement"
        >
          {KINDS.map((k) => <option key={k} value={k}>{kindLabel(k)}</option>)}
        </select>
        <select
          value={category}
          onChange={(ev) => setCategory(ev.target.value as EngagementCategory)}
          className="rounded border p-1 text-xs"
          disabled={pending}
          title="Catégorie"
        >
          {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
        </select>
        <select
          value={proofReq}
          onChange={(ev) => setProofReq(ev.target.value as EngagementProofRequirement)}
          className="rounded border p-1 text-xs"
          disabled={pending}
        >
          {(Object.keys(PROOF_REQUIREMENT_LABELS) as EngagementProofRequirement[]).map((p) => (
            <option key={p} value={p}>{PROOF_REQUIREMENT_LABELS[p]}</option>
          ))}
        </select>
        <select
          value={destination}
          onChange={(ev) => setDestination(ev.target.value as EngagementDestination)}
          className="rounded border p-1 text-xs"
          disabled={pending}
          title="Destination de la proposition"
        >
          {CURATION_DESTINATIONS.map((d) => (
            <option key={d} value={d}>{DESTINATION_META[d].label}</option>
          ))}
        </select>
        <div className="flex items-center gap-1 ml-auto">
          <button
            type="button"
            onClick={submit}
            disabled={pending || label.trim().length < 3}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-emerald-300 bg-emerald-50 text-emerald-700 text-xs disabled:opacity-50"
          >
            <Check className="h-3 w-3" /> Sauver
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="px-2 py-0.5 rounded border text-xs disabled:opacity-50"
          >
            Annuler
          </button>
        </div>
      </div>
    </div>
  )
}
