'use client'

// ── Panneau d'affectation du responsable d'une Action — PARTAGÉ par les 3 points
// d'entrée (Point, Vue Actions, Fiche Action). Lot normalisation Vincent 2026-09-15 :
// « Même geste, même composant, même mutation partout. » Extrait du panneau
// `mode='edit'` déjà en prod dans PointActionMenu.tsx — aucune nouvelle logique
// métier, aucun nouveau mécanisme. Réutilise EXCLUSIVEMENT `updateActionAssignmentAction`.

import { useState, useTransition } from 'react'
import { Loader2 } from 'lucide-react'
import { updateActionAssignmentAction } from '@/app/(dashboard)/actions/actions'
import type { ResponsibleCandidate } from '@/lib/knowledge/action-responsible-candidates'
import type { SiteCandidateCompany } from '@/lib/db/site-intervenants'

export function ActionAssignmentPanel({
  actionId,
  responsibleCandidates,
  companies,
  initialContactId = '',
  initialCompanyId = '',
  initialDueDate = '',
  suggestedResponsibleName = null,
  onDone,
  onCancel,
  title = "Modifier l'action",
}: {
  actionId: string
  responsibleCandidates: ResponsibleCandidate[]
  companies: SiteCandidateCompany[]
  initialContactId?: string
  initialCompanyId?: string
  initialDueDate?: string
  suggestedResponsibleName?: string | null
  onDone: () => void | Promise<void>
  onCancel: () => void
  title?: string
}) {
  const [pending, startTransition] = useTransition()
  const [contactId, setContactId] = useState(initialContactId)
  const [companyId, setCompanyId] = useState(initialCompanyId)
  const [dueDate, setDueDate] = useState(initialDueDate)
  const [confirmMismatch, setConfirmMismatch] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function applySuggestion(name: string) {
    const contact = responsibleCandidates.find((c) => c.fullName === name)
    if (contact) { setContactId(contact.contactId); return }
    const company = companies.find((c) => c.name === name)
    if (company) setCompanyId(company.id)
  }

  function submit() {
    setError(null)
    const fd = new FormData()
    fd.set('id', actionId)
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
      await onDone()
    })
  }

  return (
    <div className="w-80 space-y-2 rounded-lg border bg-card p-3 shadow-md">
      <p className="text-[11px] font-medium">{title}</p>

      {suggestedResponsibleName && !contactId && !companyId && (
        <div className="flex items-center justify-between gap-2 rounded-md bg-violet-50 px-2 py-1.5 text-[11px] text-violet-800 dark:bg-violet-950/30 dark:text-violet-300">
          <span>Suggestion MemorIA : {suggestedResponsibleName}</span>
          <button type="button" onClick={() => applySuggestion(suggestedResponsibleName)}
            className="shrink-0 rounded-md border border-violet-300 bg-white px-2 py-0.5 font-medium text-violet-700 hover:bg-violet-100 dark:border-violet-800 dark:bg-transparent dark:text-violet-300">
            Utiliser {suggestedResponsibleName}
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
        <button type="button" onClick={submit} disabled={pending}
          className="inline-flex items-center gap-1 rounded-md bg-sky-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-sky-700 disabled:opacity-50">
          {pending && <Loader2 className="h-3 w-3 animate-spin" />} Enregistrer
        </button>
        <button type="button" onClick={onCancel} disabled={pending}
          className="rounded-md border px-2.5 py-1 text-[11px] hover:bg-muted/60 disabled:opacity-50">Annuler</button>
      </div>
    </div>
  )
}
