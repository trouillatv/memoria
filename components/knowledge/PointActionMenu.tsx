'use client'

// ── Menu « … » d'une Action, depuis la fiche Point (lot Point Actions inline,
// mandat Vincent) ────────────────────────────────────────────────────────────
// Réutilise EXCLUSIVEMENT les server actions déjà existantes de
// app/(dashboard)/actions/actions.ts (closeActionAction/reopenActionAction pour
// le cycle de vie, updateActionAssignmentAction pour Responsable/Entreprise/
// Échéance) — aucun nouveau moteur d'état. « Voir le détail » reste un lien
// secondaire vers la destination actuelle (le titre de la ligne n'est plus
// cliquable : le Point devient le cockpit local des Actions).
//
// Suggestion GAP 1 : jamais appliquée automatiquement — seul un clic explicite
// sur « Utiliser <nom> » copie la suggestion dans le champ Responsable/Entreprise
// du formulaire, encore modifiable avant Enregistrer.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { MoreHorizontal, Loader2, Check, RotateCcw, Pencil, Eye } from 'lucide-react'
import { closeActionAction, reopenActionAction, updateActionAssignmentAction } from '@/app/(dashboard)/actions/actions'
import type { PointDetailLinkedObject } from '@/lib/knowledge/tracked-point-detail'
import type { ResponsibleCandidate } from '@/lib/knowledge/action-responsible-candidates'
import type { SiteCandidateCompany } from '@/lib/db/site-intervenants'

type Mode = null | 'menu' | 'treat' | 'reopen' | 'edit'

export function PointActionMenu({
  action,
  siteId,
  responsibleCandidates,
  companies,
}: {
  action: PointDetailLinkedObject
  siteId: string
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
  const [contactId, setContactId] = useState(currentContactId)
  const [companyId, setCompanyId] = useState(currentCompanyId)
  const [dueDate, setDueDate] = useState(action.dueDate ?? '')
  const [confirmMismatch, setConfirmMismatch] = useState(false)

  function closeMenus() {
    setMode(null); setComment(''); setError(null); setConfirmMismatch(false)
  }

  function submitTreat() {
    if (comment.trim().length === 0) return
    setError(null)
    const fd = new FormData()
    fd.set('id', action.id); fd.set('site_id', siteId); fd.set('comment', comment.trim())
    startTransition(async () => {
      const r = await closeActionAction(fd)
      if (!r.ok) { setError(r.error); return }
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
      closeMenus(); router.refresh()
    })
  }

  function submitEdit() {
    setError(null)
    const fd = new FormData()
    fd.set('id', action.id)
    if (contactId) fd.set('assigned_contact_id', contactId)
    if (companyId) fd.set('assigned_company_id', companyId)
    if (dueDate) fd.set('due_date', dueDate)
    if (confirmMismatch) fd.set('confirm_mismatch', 'true')
    startTransition(async () => {
      const r = await updateActionAssignmentAction(fd)
      if (!r.ok) {
        setError(r.error)
        if (r.requiresConfirmation) setConfirmMismatch(true)
        return
      }
      closeMenus(); router.refresh()
    })
  }

  function applySuggestion(name: string) {
    const contact = responsibleCandidates.find((c) => c.fullName === name)
    if (contact) { setContactId(contact.contactId); return }
    const company = companies.find((c) => c.name === name)
    if (company) setCompanyId(company.id)
  }

  return (
    <div className="relative inline-block text-left">
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
          <Link href={action.href} onClick={() => setMode(null)}
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[12.5px] text-muted-foreground hover:bg-muted/60">
            <Eye className="h-3.5 w-3.5" /> Voir le détail
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
        <div className="absolute right-0 top-full z-10 mt-1 w-80 space-y-2 rounded-lg border bg-card p-3 shadow-md">
          <p className="text-[11px] font-medium">Modifier l&apos;action</p>

          {action.suggestedResponsibleName && !contactId && !companyId && (
            <div className="flex items-center justify-between gap-2 rounded-md bg-violet-50 px-2 py-1.5 text-[11px] text-violet-800 dark:bg-violet-950/30 dark:text-violet-300">
              <span>Suggestion MemorIA : {action.suggestedResponsibleName}</span>
              <button type="button" onClick={() => applySuggestion(action.suggestedResponsibleName!)}
                className="shrink-0 rounded-md border border-violet-300 bg-white px-2 py-0.5 font-medium text-violet-700 hover:bg-violet-100 dark:border-violet-800 dark:bg-transparent dark:text-violet-300">
                Utiliser {action.suggestedResponsibleName}
              </button>
            </div>
          )}

          <label className="block space-y-0.5 text-[11px]">
            <span className="font-medium text-foreground">Responsable</span>
            <span className="block text-muted-foreground">Une personne</span>
            <select value={contactId} onChange={(e) => setContactId(e.target.value)} disabled={pending}
              className="w-full rounded border bg-background px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-ring">
              <option value="">—</option>
              {responsibleCandidates.map((c) => (
                <option key={c.contactId} value={c.contactId}>{c.fullName}{c.fonction ? ` · ${c.fonction}` : ''}</option>
              ))}
            </select>
          </label>

          <label className="block space-y-0.5 text-[11px]">
            <span className="font-medium text-foreground">Entreprise</span>
            <span className="block text-muted-foreground">La société ou le prestataire</span>
            <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} disabled={pending}
              className="w-full rounded border bg-background px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-ring">
              <option value="">—</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>

          <label className="block space-y-0.5 text-[11px]">
            <span className="font-medium text-foreground">Échéance</span>
            <input type="date" value={dueDate ?? ''} onChange={(e) => setDueDate(e.target.value)} disabled={pending}
              className="w-full rounded border bg-background px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-ring" />
          </label>

          {confirmMismatch && (
            <p className="text-[11px] text-amber-700 dark:text-amber-400">Confirmez à nouveau pour enregistrer malgré l&apos;incohérence signalée.</p>
          )}
          {error && <p className="text-[11px] text-red-600">{error}</p>}
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={submitEdit} disabled={pending}
              className="inline-flex items-center gap-1 rounded-md bg-sky-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-sky-700 disabled:opacity-50">
              {pending && <Loader2 className="h-3 w-3 animate-spin" />} Enregistrer
            </button>
            <button type="button" onClick={closeMenus} disabled={pending}
              className="rounded-md border px-2.5 py-1 text-[11px] hover:bg-muted/60 disabled:opacity-50">Annuler</button>
          </div>
        </div>
      )}
    </div>
  )
}
