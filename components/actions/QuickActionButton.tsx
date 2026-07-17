'use client'

// ➕ Action — création STANDALONE rapide (2026-06-16).
// Débloque Observation → Action : capturer une action sur le terrain sans
// passer par un compte-rendu ni une réunion.
//
// Volontairement minimal : titre (obligatoire) + échéance (optionnelle).
// Aucun champ ERP (corps d'état, responsable, priorité) — le bureau enrichit.
// Sujet = le LIEU : si aucun site n'est fixé par le contexte (ex. /actions),
// la sélection du site est OBLIGATOIRE.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { createQuickActionAction } from '@/app/(dashboard)/actions/actions'

interface Props {
  source: 'mobile_site' | 'desktop_site' | 'actions_list'
  /** Site fixé par le contexte (fiche site / mobile site). */
  siteId?: string
  /** Sélecteur de site (obligatoire) quand aucun site n'est fixé (/actions). */
  sites?: Array<{ id: string; name: string }>
  variant?: 'mobile' | 'desktop'
}

export function QuickActionButton({ source, siteId, sites, variant = 'desktop' }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [selectedSite, setSelectedSite] = useState('')
  const [pending, startTransition] = useTransition()

  const needsSitePick = !siteId
  const effectiveSite = siteId ?? selectedSite
  const canSubmit = title.trim().length > 0 && effectiveSite.length > 0 && !pending

  function reset() {
    setTitle('')
    setDueDate('')
    setSelectedSite('')
  }

  function submit() {
    if (!canSubmit) return
    const fd = new FormData()
    fd.set('site_id', effectiveSite)
    fd.set('title', title.trim())
    if (dueDate) fd.set('due_date', dueDate)
    fd.set('created_from', source)
    startTransition(async () => {
      const r = await createQuickActionAction(fd)
      if (r.ok) {
        toast.success('Action créée')
        reset()
        setOpen(false)
        router.refresh()
      } else {
        toast.error(r.error)
      }
    })
  }

  const trigger = (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className={
        variant === 'mobile'
          ? 'h-full w-full inline-flex items-center justify-center gap-2 rounded-xl border bg-muted/30 shadow-sm px-4 py-3.5 text-sm font-medium active:brightness-95 transition'
          : 'inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:border-foreground/40 hover:bg-muted/40 transition-[transform,colors] active:scale-[0.97]'
      }
    >
      <Plus className="h-4 w-4 text-emerald-600" /> Action
    </button>
  )

  const formCard = (
    <div className="rounded-xl border bg-card p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium inline-flex items-center gap-1.5">
          <Plus className="h-4 w-4 text-muted-foreground" /> Nouvelle action
        </h3>
        <button
          type="button"
          onClick={() => { setOpen(false); reset() }}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Fermer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {needsSitePick && (
        <div className="space-y-1">
          <label htmlFor="qa-site" className="text-xs text-muted-foreground">
            Chantier <span className="text-amber-600">*</span>
          </label>
          <select
            id="qa-site"
            value={selectedSite}
            onChange={(e) => setSelectedSite(e.target.value)}
            disabled={pending}
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
          >
            <option value="">— choisir un chantier —</option>
            {(sites ?? []).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      )}

      <div className="space-y-1">
        <label htmlFor="qa-title" className="text-xs text-muted-foreground">
          Titre <span className="text-amber-600">*</span>
        </label>
        <input
          id="qa-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
          maxLength={200}
          placeholder="Ex : Reprendre la réservation plomberie cuisine"
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}
          disabled={pending}
          className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="qa-due" className="text-xs text-muted-foreground">
          Échéance <span className="text-muted-foreground/50">(optionnelle)</span>
        </label>
        <input
          id="qa-due"
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          disabled={pending}
          className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
        />
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={() => { setOpen(false); reset() }}
          disabled={pending}
          className="px-3 py-2 rounded-lg border text-sm disabled:opacity-50"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-foreground text-background text-sm font-medium disabled:opacity-50"
        >
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Créer
        </button>
      </div>
    </div>
  )

  // Le déclencheur reste TOUJOURS en place (la ligne ne grandit jamais) ; le
  // formulaire SORT en popup par-dessus la page — mobile ET desktop. Clic sur le
  // fond = fermer. (Avant, le desktop remplaçait le bouton par le form inline,
  // ce qui agrandissait la ligne — Vincent 2026-06-29.)
  return (
    <>
      {trigger}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-background/70 backdrop-blur-sm p-3 pt-[10vh] md:pt-[14vh]"
          onClick={(e) => { if (e.target === e.currentTarget) { setOpen(false); reset() } }}
        >
          <div className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>{formCard}</div>
        </div>
      )}
    </>
  )
}
