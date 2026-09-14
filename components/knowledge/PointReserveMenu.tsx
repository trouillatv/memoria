'use client'

// ── Menu « … » d'une Réserve, depuis la fiche Point (lot Point cockpit des objets
// liés, mandat Vincent 2026-09-14) ──────────────────────────────────────────────
// Réutilise EXCLUSIVEMENT les server actions déjà existantes de
// app/(dashboard)/sites/[id]/reserves/actions.ts (liftReserveAction,
// addCorrectiveActionAction) — aucun nouveau moteur d'état, aucun nouveau champ.
// Pas de geste « affecter un responsable » : site_reserve n'a aucun champ humain-
// éditable pour ça (responsible_company_id n'est peuplé que par l'import historique).
// Pas de geste « ouvrir la source » : les preuves d'une réserve sont toujours [] dans
// ce read-model.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { MoreHorizontal, Loader2, ShieldCheck, ListPlus } from 'lucide-react'
import { liftReserveAction, addCorrectiveActionAction } from '@/app/(dashboard)/sites/[id]/reserves/actions'
import { recordPointReviewedAfterGesture } from '@/lib/knowledge/tracked-point-review-actions'
import type { PointDetailLinkedObject } from '@/lib/knowledge/tracked-point-detail'

type Mode = null | 'menu' | 'lift' | 'corrective'

export function PointReserveMenu({
  reserve,
  siteId,
  pointId,
}: {
  reserve: PointDetailLinkedObject
  siteId: string
  pointId: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [mode, setMode] = useState<Mode>(null)
  const [liftNote, setLiftNote] = useState('')
  const [title, setTitle] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [error, setError] = useState<string | null>(null)

  function closeMenus() {
    setMode(null); setLiftNote(''); setTitle(''); setAssignedTo(''); setError(null)
  }

  function submitLift() {
    setError(null)
    const fd = new FormData()
    fd.set('id', reserve.id); fd.set('siteId', siteId)
    if (liftNote.trim()) fd.set('liftNote', liftNote.trim())
    startTransition(async () => {
      const r = await liftReserveAction(fd)
      if ('error' in r) { setError(r.error); return }
      await recordPointReviewedAfterGesture(siteId, pointId)
      closeMenus(); router.refresh()
    })
  }

  function submitCorrective() {
    if (title.trim().length === 0) return
    setError(null)
    const fd = new FormData()
    fd.set('siteId', siteId); fd.set('reserveId', reserve.id); fd.set('title', title.trim())
    if (assignedTo.trim()) fd.set('assignedTo', assignedTo.trim())
    startTransition(async () => {
      const r = await addCorrectiveActionAction(fd)
      if ('error' in r) { setError(r.error); return }
      await recordPointReviewedAfterGesture(siteId, pointId)
      closeMenus(); router.refresh()
    })
  }

  return (
    <div className="relative inline-block text-left">
      <button
        type="button"
        aria-label="Autres gestes sur cette réserve"
        onClick={() => setMode(mode === null ? 'menu' : null)}
        className="inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted/60"
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>

      {mode === 'menu' && (
        <div className="absolute right-0 top-full z-10 mt-1 w-56 space-y-0.5 rounded-lg border bg-card p-1 shadow-md">
          {!reserve.isDone && (
            <button type="button" onClick={() => { setMode('lift'); setError(null) }}
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-950/40">
              <ShieldCheck className="h-3.5 w-3.5" /> Lever la réserve
            </button>
          )}
          <button type="button" onClick={() => { setMode('corrective'); setError(null) }}
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-sky-50 hover:text-sky-700 dark:hover:bg-sky-950/40">
            <ListPlus className="h-3.5 w-3.5" /> Ajouter une action corrective
          </button>
        </div>
      )}

      {mode === 'lift' && (
        <div className="absolute right-0 top-full z-10 mt-1 w-72 space-y-1.5 rounded-lg border bg-card p-2.5 shadow-md">
          <p className="text-[11px] font-medium">Lever cette réserve ?</p>
          <textarea value={liftNote} onChange={(e) => setLiftNote(e.target.value)} disabled={pending}
            placeholder="Constat de levée (facultatif)" rows={2} maxLength={280}
            className="w-full rounded border bg-background px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-ring" />
          {error && <p className="text-[11px] text-red-600">{error}</p>}
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={submitLift} disabled={pending}
              className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
              {pending && <Loader2 className="h-3 w-3 animate-spin" />} Confirmer
            </button>
            <button type="button" onClick={closeMenus} disabled={pending}
              className="rounded-md border px-2.5 py-1 text-[11px] hover:bg-muted/60 disabled:opacity-50">Annuler</button>
          </div>
        </div>
      )}

      {mode === 'corrective' && (
        <div className="absolute right-0 top-full z-10 mt-1 w-80 space-y-2 rounded-lg border bg-card p-3 shadow-md">
          <p className="text-[11px] font-medium">Ajouter une action corrective</p>
          <label className="block space-y-0.5 text-[11px]">
            <span className="font-medium text-foreground">Intitulé</span>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} disabled={pending}
              maxLength={200} placeholder="Que faut-il faire ?"
              className="w-full rounded border bg-background px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-ring" />
          </label>
          <label className="block space-y-0.5 text-[11px]">
            <span className="font-medium text-foreground">Assigné à (facultatif)</span>
            <input type="text" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} disabled={pending}
              maxLength={120}
              className="w-full rounded border bg-background px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-ring" />
          </label>
          {error && <p className="text-[11px] text-red-600">{error}</p>}
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={submitCorrective} disabled={pending || title.trim().length === 0}
              className="inline-flex items-center gap-1 rounded-md bg-sky-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-sky-700 disabled:opacity-50">
              {pending && <Loader2 className="h-3 w-3 animate-spin" />} Créer
            </button>
            <button type="button" onClick={closeMenus} disabled={pending}
              className="rounded-md border px-2.5 py-1 text-[11px] hover:bg-muted/60 disabled:opacity-50">Annuler</button>
          </div>
        </div>
      )}
    </div>
  )
}
