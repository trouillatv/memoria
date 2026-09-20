'use client'

// ── Menu « … » d'une Action, depuis la fiche Point (lot Point Actions inline,
// mandat Vincent ; retour partiel mandat Vincent 2026-09-14 lot Point cockpit
// des objets liés) ───────────────────────────────────────────────────────────
// Réutilise EXCLUSIVEMENT les server actions déjà existantes de
// app/(dashboard)/actions/actions.ts (closeActionAction/reopenActionAction pour
// le cycle de vie, updateActionAssignmentAction pour Responsable/Entreprise/
// Échéance) — aucun nouveau moteur d'état. Le titre de la ligne (rendu par
// PointFicheView, pas ici) est À NOUVEAU un lien de consultation vers la fiche
// Action dédiée — « Voir dans Actions » reste, lui, une sortie séparée et
// distincte vers la vue globale du site (?actionId= cible/surligne la ligne).
//
// Suggestion GAP 1 : jamais appliquée automatiquement — seul un clic explicite
// sur « Utiliser <nom> » copie la suggestion dans le champ Responsable/Entreprise
// du formulaire, encore modifiable avant Enregistrer.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { MoreHorizontal, Loader2, Check, RotateCcw, Pencil, Eye, UserPlus } from 'lucide-react'
import { closeActionAction, reopenActionAction } from '@/app/(dashboard)/actions/actions'
import { recordPointReviewedAfterGesture } from '@/lib/knowledge/tracked-point-review-actions'
import { ActionAssignmentPanel } from '@/components/actions/ActionAssignmentPanel'
import type { PointDetailLinkedObject } from '@/lib/knowledge/tracked-point-detail'
import type { ResponsibleCandidate } from '@/lib/knowledge/action-responsible-candidates'
import type { SiteCandidateCompany } from '@/lib/db/site-intervenants'

type Mode = null | 'menu' | 'treat' | 'reopen' | 'edit'

export function PointActionMenu({
  action,
  siteId,
  pointId,
  responsibleCandidates,
  companies,
}: {
  action: PointDetailLinkedObject
  siteId: string
  pointId: string
  responsibleCandidates: ResponsibleCandidate[]
  companies: SiteCandidateCompany[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [mode, setMode] = useState<Mode>(null)
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)

  const responsible = action.responsible
  const currentContactId = responsible?.kind === 'contact'
    ? responsibleCandidates.find((c) => c.fullName === responsible.name)?.contactId ?? ''
    : ''
  const currentCompanyId = responsible?.kind === 'company'
    ? companies.find((c) => c.name === responsible.name)?.id ?? ''
    : ''
  // Recette Vincent 2026-09-15 : le menu doit exposer un point d'entrée
  // explicite vers l'affectation (mode='edit'), pas seulement « Modifier… ».
  // Même mutation/même panneau que « Modifier… » — aucun mécanisme parallèle.
  const responsibleLabel = responsible?.kind === 'contact' || responsible?.kind === 'company'
    ? `Changer le responsable · ${responsible.name}`
    : 'Affecter un responsable…'

  function closeMenus() {
    setMode(null); setComment(''); setError(null)
  }

  function submitTreat() {
    if (comment.trim().length === 0) return
    setError(null)
    const fd = new FormData()
    fd.set('id', action.id); fd.set('site_id', siteId); fd.set('comment', comment.trim())
    startTransition(async () => {
      const r = await closeActionAction(fd)
      if (!r.ok) { setError(r.error); return }
      await recordPointReviewedAfterGesture(siteId, pointId)
      closeMenus(); router.refresh()
    })
  }

  function submitReopen() {
    setError(null)
    const fd = new FormData()
    fd.set('id', action.id); fd.set('site_id', siteId); fd.set('reason', comment.trim())
    startTransition(async () => {
      const r = await reopenActionAction(fd)
      if (!r.ok) { setError(r.error); return }
      await recordPointReviewedAfterGesture(siteId, pointId)
      closeMenus(); router.refresh()
    })
  }

  async function handleAssignmentDone() {
    await recordPointReviewedAfterGesture(siteId, pointId)
    closeMenus(); router.refresh()
  }

  return (
    <div className="relative inline-flex items-center gap-1 text-left">
      {/* Recette Vincent 2026-09-21 : « Affecter » doit être visible directement sur
          la ligne quand il n'y a pas de responsable, pas seulement accessible via le
          menu « … ». Même mécanisme (mode='edit' → ActionAssignmentPanel), pas de
          nouveau chemin. */}
      {!responsible && (
        <button
          type="button"
          onClick={() => { setMode('edit'); setError(null) }}
          className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400"
        >
          <UserPlus className="h-3 w-3" /> Affecter
        </button>
      )}
      <button
        type="button"
        aria-label="Autres gestes sur cette action"
        onClick={() => setMode(mode === null ? 'menu' : null)}
        className="inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted/60"
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>

      {mode === 'menu' && (
        <div className="absolute right-0 top-full z-10 mt-1 w-56 space-y-0.5 rounded-lg border bg-card p-1 shadow-md">
          {!action.isDone && (
            <button type="button" onClick={() => { setMode('treat'); setError(null) }}
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-950/40">
              <Check className="h-3.5 w-3.5" /> Marquer traitée
            </button>
          )}
          {action.isDone && (
            <button type="button" onClick={() => { setMode('reopen'); setError(null) }}
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-orange-50 hover:text-orange-700 dark:hover:bg-orange-950/40">
              <RotateCcw className="h-3.5 w-3.5" /> Rouvrir
            </button>
          )}
          <button type="button" onClick={() => { setMode('edit'); setError(null) }}
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-sky-50 hover:text-sky-700 dark:hover:bg-sky-950/40">
            <Pencil className="h-3.5 w-3.5" /> Modifier…
          </button>
          <button type="button" onClick={() => { setMode('edit'); setError(null) }}
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-violet-50 hover:text-violet-700 dark:hover:bg-violet-950/40">
            <UserPlus className="h-3.5 w-3.5" /> {responsibleLabel}
          </button>
          <Link href={action.href} onClick={() => setMode(null)}
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[12.5px] text-muted-foreground hover:bg-muted/60">
            <Eye className="h-3.5 w-3.5" /> Voir dans Actions
          </Link>
        </div>
      )}

      {mode === 'treat' && (
        <div className="absolute right-0 top-full z-10 mt-1 w-72 space-y-1.5 rounded-lg border bg-card p-2.5 shadow-md">
          <p className="text-[11px] font-medium">Marquer cette action comme traitée ?</p>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} disabled={pending}
            placeholder="Qu'avez-vous fait ? (obligatoire)" rows={2} maxLength={1000}
            className="w-full rounded border bg-background px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-ring" />
          {error && <p className="text-[11px] text-red-600">{error}</p>}
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={submitTreat} disabled={pending || comment.trim().length === 0}
              className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
              {pending && <Loader2 className="h-3 w-3 animate-spin" />} Confirmer
            </button>
            <button type="button" onClick={closeMenus} disabled={pending}
              className="rounded-md border px-2.5 py-1 text-[11px] hover:bg-muted/60 disabled:opacity-50">Annuler</button>
          </div>
        </div>
      )}

      {mode === 'reopen' && (
        <div className="absolute right-0 top-full z-10 mt-1 w-72 space-y-1.5 rounded-lg border bg-card p-2.5 shadow-md">
          <p className="text-[11px] font-medium">Rouvrir cette action ?</p>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} disabled={pending}
            placeholder="Motif (facultatif)" rows={2} maxLength={1000}
            className="w-full rounded border bg-background px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-ring" />
          {error && <p className="text-[11px] text-red-600">{error}</p>}
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={submitReopen} disabled={pending}
              className="inline-flex items-center gap-1 rounded-md bg-orange-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-orange-700 disabled:opacity-50">
              {pending && <Loader2 className="h-3 w-3 animate-spin" />} Confirmer la réouverture
            </button>
            <button type="button" onClick={closeMenus} disabled={pending}
              className="rounded-md border px-2.5 py-1 text-[11px] hover:bg-muted/60 disabled:opacity-50">Annuler</button>
          </div>
        </div>
      )}

      {mode === 'edit' && (
        <div className="absolute right-0 top-full z-10 mt-1">
          <ActionAssignmentPanel
            actionId={action.id}
            responsibleCandidates={responsibleCandidates}
            companies={companies}
            initialContactId={currentContactId}
            initialCompanyId={currentCompanyId}
            initialDueDate={action.dueDate ?? ''}
            suggestedResponsibleName={action.suggestedResponsibleName}
            onDone={handleAssignmentDone}
            onCancel={closeMenus}
            title="Modifier l'action"
          />
        </div>
      )}
    </div>
  )
}
