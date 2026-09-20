'use client'

// Lot Acteurs — trois blocs distincts (mandat Vincent 2026-09-20) : « Piloter ce Point »
// doit être atteignable SANS passer par une entreprise déjà citée dans les preuves — sinon
// piloter un Point dont aucune entreprise n'a encore été détectée par extraction reste
// impossible. Même mutation que PointCitedCompanyPromote (designateResponsibleCompanyAction),
// simple sélection dans les entreprises déjà connues du chantier (`companies`, même liste que
// ActionAssignmentPanel) au lieu d'un companyId pré-rempli par la citation.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { designateResponsibleCompanyAction } from '@/app/(dashboard)/sites/[id]/tracked-point-responsible-company-actions'
import type { SiteCandidateCompany } from '@/lib/db/site-intervenants'

export function PointPilotAssign({
  siteId,
  pointId,
  companies,
}: {
  siteId: string
  pointId: string
  companies: SiteCandidateCompany[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [companyId, setCompanyId] = useState('')
  const [error, setError] = useState<string | null>(null)

  function close() {
    setOpen(false); setCompanyId(''); setError(null)
  }

  function submit() {
    if (!companyId) return
    setError(null)
    startTransition(async () => {
      const r = await designateResponsibleCompanyAction({ siteId, pointId, companyId })
      if (!r.ok) { setError(r.error); return }
      close(); router.refresh()
    })
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-md border border-dashed px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted/60"
      >
        Affecter…
      </button>

      {open && (
        <div className="absolute left-0 top-full z-10 mt-1 w-72 max-w-[85vw] space-y-1.5 rounded-lg border bg-card p-2.5 shadow-md">
          <p className="text-[11px] font-medium text-foreground">Quelle entreprise pilote ce Point ?</p>
          <select
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            disabled={pending}
            className="w-full rounded border bg-background px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">Choisir une entreprise…</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          {error && <p className="text-[11px] text-red-600">{error}</p>}
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={submit} disabled={pending || !companyId}
              className="inline-flex items-center gap-1 rounded-md bg-sky-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-sky-700 disabled:opacity-50">
              {pending && <Loader2 className="h-3 w-3 animate-spin" />} Confirmer
            </button>
            <button type="button" onClick={close} disabled={pending}
              className="rounded-md border px-2.5 py-1 text-[11px] hover:bg-muted/60 disabled:opacity-50">Annuler</button>
          </div>
        </div>
      )}
    </div>
  )
}
