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
import type { DbEngagement, EngagementCategory } from '@/types/db'

const CATEGORIES: EngagementCategory[] = [
  'frequency', 'quality', 'compliance', 'delivery', 'sla', 'reporting', 'other',
]

export function EngagementCurationView({ engagements }: { engagements: DbEngagement[] }) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

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
    patch: { short_label?: string; category?: EngagementCategory }
  ) {
    const fd = new FormData()
    fd.set('id', id)
    if (patch.short_label !== undefined) fd.set('short_label', patch.short_label)
    if (patch.category !== undefined) fd.set('category', patch.category)
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

      <ul className="space-y-2">
        {engagements.map((e) => {
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
    </div>
  )
}

function EditForm({
  engagement,
  pending,
  onSave,
  onCancel,
}: {
  engagement: DbEngagement
  pending: boolean
  onSave: (patch: { short_label?: string; category?: EngagementCategory }) => void
  onCancel: () => void
}) {
  const [label, setLabel] = useState(engagement.short_label)
  const [category, setCategory] = useState<EngagementCategory>(engagement.category)

  function submit() {
    const patch: { short_label?: string; category?: EngagementCategory } = {}
    if (label !== engagement.short_label) patch.short_label = label
    if (category !== engagement.category) patch.category = category
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
      <div className="flex items-center gap-2">
        <select
          value={category}
          onChange={(ev) => setCategory(ev.target.value as EngagementCategory)}
          className="rounded border p-1 text-xs"
          disabled={pending}
        >
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
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
