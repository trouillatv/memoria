'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Trash2, Plus, RotateCcw, Star, Check, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import {
  addChecklistItemAction,
  removeChecklistItemAction,
  updateChecklistItemAction,
  restoreChecklistFromMissionAction,
} from './actions'
import type { DbInterventionChecklistItem } from '@/types/db'

interface Props {
  interventionId: string
  items: DbInterventionChecklistItem[]
  hasMissionTemplate: boolean
}

export function EditChecklistSheet({ interventionId, items, hasMissionTemplate }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  // Ajout d'un nouvel item
  const [newLabel, setNewLabel] = useState('')
  const [newRequired, setNewRequired] = useState(false)

  // Édition inline d'un item existant
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')

  // Confirmation "Restaurer depuis la mission"
  const [restoreConfirm, setRestoreConfirm] = useState(false)

  function refresh() {
    router.refresh()
  }

  async function handleAdd() {
    const label = newLabel.trim()
    if (!label) return
    const fd = new FormData()
    fd.set('intervention_id', interventionId)
    fd.set('label', label)
    fd.set('required', String(newRequired))
    startTransition(async () => {
      const r = await addChecklistItemAction(fd)
      if ('error' in r) { toast.error(r.error); return }
      setNewLabel('')
      setNewRequired(false)
      refresh()
    })
  }

  async function handleRemove(itemId: string) {
    const fd = new FormData()
    fd.set('intervention_id', interventionId)
    fd.set('item_id', itemId)
    startTransition(async () => {
      const r = await removeChecklistItemAction(fd)
      if ('error' in r) { toast.error(r.error); return }
      refresh()
    })
  }

  function startEdit(item: DbInterventionChecklistItem) {
    setEditingId(item.id)
    setEditLabel(item.label)
  }

  async function commitEdit(item: DbInterventionChecklistItem) {
    const label = editLabel.trim()
    if (!label || label === item.label) { setEditingId(null); return }
    const fd = new FormData()
    fd.set('intervention_id', interventionId)
    fd.set('item_id', item.id)
    fd.set('label', label)
    startTransition(async () => {
      const r = await updateChecklistItemAction(fd)
      if ('error' in r) { toast.error(r.error); return }
      setEditingId(null)
      refresh()
    })
  }

  async function handleToggleRequired(item: DbInterventionChecklistItem) {
    const fd = new FormData()
    fd.set('intervention_id', interventionId)
    fd.set('item_id', item.id)
    fd.set('required', String(!item.required))
    startTransition(async () => {
      const r = await updateChecklistItemAction(fd)
      if ('error' in r) { toast.error(r.error); return }
      refresh()
    })
  }

  async function handleRestore() {
    if (!restoreConfirm) { setRestoreConfirm(true); return }
    const fd = new FormData()
    fd.set('intervention_id', interventionId)
    startTransition(async () => {
      const r = await restoreChecklistFromMissionAction(fd)
      if ('error' in r) { toast.error(r.error); return }
      setRestoreConfirm(false)
      refresh()
    })
  }

  return (
    <Sheet open={open} onOpenChange={(v) => { setOpen(v); setRestoreConfirm(false); setEditingId(null) }}>
      <SheetTrigger
        render={
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground border border-border bg-muted/30 active:bg-muted/60"
          />
        }
      >
        <Pencil className="h-3 w-3" />
        Modifier
      </SheetTrigger>

      <SheetContent side="bottom" className="max-h-[85svh] overflow-y-auto rounded-t-2xl px-4 pb-8">
        <SheetHeader className="mb-4">
          <SheetTitle className="text-base">Modifier la checklist</SheetTitle>
        </SheetHeader>

        {/* Liste des items */}
        <ul className="space-y-2 mb-6">
          {items.map((item) => (
            <li
              key={item.id}
              className="rounded-xl border border-border bg-card p-3 space-y-2"
            >
              <div className="flex items-start gap-2">
                {editingId === item.id ? (
                  <input
                    autoFocus
                    className="flex-1 min-w-0 rounded-lg border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                    onBlur={() => commitEdit(item)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitEdit(item)
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="flex-1 min-w-0 text-left text-sm leading-snug text-foreground"
                    onClick={() => startEdit(item)}
                  >
                    {item.label}
                  </button>
                )}

                <div className="flex items-center gap-1 shrink-0">
                  {/* Obligatoire toggle */}
                  <button
                    type="button"
                    title={item.required ? 'Rendre facultatif' : 'Rendre obligatoire'}
                    onClick={() => handleToggleRequired(item)}
                    disabled={isPending}
                    className={`w-7 h-7 rounded-full flex items-center justify-center border ${
                      item.required
                        ? 'bg-amber-50 border-amber-300 text-amber-600'
                        : 'bg-muted/30 border-border text-muted-foreground'
                    }`}
                  >
                    <Star className="h-3.5 w-3.5" fill={item.required ? 'currentColor' : 'none'} />
                  </button>

                  {/* Éditer */}
                  <button
                    type="button"
                    onClick={() => startEdit(item)}
                    disabled={isPending}
                    className="w-7 h-7 rounded-full flex items-center justify-center border border-border bg-muted/30 text-muted-foreground"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>

                  {/* Supprimer */}
                  <button
                    type="button"
                    onClick={() => handleRemove(item.id)}
                    disabled={isPending}
                    className="w-7 h-7 rounded-full flex items-center justify-center border border-border bg-muted/30 text-muted-foreground hover:text-destructive hover:border-destructive/40"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Badge source */}
              {item.source === 'local' && (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-sky-700 bg-sky-50 border border-sky-200 rounded-full px-1.5 py-0.5">
                  <Plus className="h-2.5 w-2.5" />
                  Ajouté pour cette intervention
                </span>
              )}
            </li>
          ))}

          {items.length === 0 && (
            <li className="text-sm text-muted-foreground text-center py-4">
              Aucun item — ajoutez-en ci-dessous.
            </li>
          )}
        </ul>

        {/* Ajouter un item */}
        <div className="rounded-xl border border-dashed border-border bg-muted/20 p-3 space-y-2 mb-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Ajouter un point</p>
          <input
            type="text"
            placeholder="Libellé du point de contrôle…"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }}
          />
          <div className="flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                className="rounded border-border"
                checked={newRequired}
                onChange={(e) => setNewRequired(e.target.checked)}
              />
              Obligatoire
            </label>
            <button
              type="button"
              disabled={!newLabel.trim() || isPending}
              onClick={handleAdd}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40 active:bg-brand-700"
            >
              <Plus className="h-3.5 w-3.5" />
              Ajouter
            </button>
          </div>
        </div>

        {/* Restaurer depuis le modèle de la mission */}
        {hasMissionTemplate && (
          <div className="border-t border-border pt-4">
            {restoreConfirm ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Les items du modèle seront remplacés. Les points ajoutés localement sont conservés.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={handleRestore}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-foreground px-3 py-2 text-sm font-medium text-background active:opacity-70"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Confirmer
                  </button>
                  <button
                    type="button"
                    onClick={() => setRestoreConfirm(false)}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                    Annuler
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                disabled={isPending}
                onClick={() => setRestoreConfirm(true)}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground active:bg-muted/40"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Restaurer le modèle de la mission
              </button>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
