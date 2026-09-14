'use client'

// Lot Entreprise citée → Responsable (mandat Vincent 2026-09-14, cas Clim Exp'Air) — geste
// humain explicite qui transforme une entreprise simplement citée (détection textuelle,
// jamais une promotion automatique) en responsable structuré du Point. Même squelette
// d'interaction que PointActionMenu (useTransition, popover inline, confirmation obligatoire,
// Loader2, annulation) : ici un seul geste, donc pas de menu intermédiaire.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { designateResponsibleCompanyAction } from '@/app/(dashboard)/sites/[id]/tracked-point-responsible-company-actions'

export function PointCitedCompanyPromote({
  siteId,
  pointId,
  companyId,
  companyName,
}: {
  siteId: string
  pointId: string
  companyId: string
  companyName: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function submit() {
    setError(null)
    startTransition(async () => {
      const r = await designateResponsibleCompanyAction({ siteId, pointId, companyId })
      if (!r.ok) { setError(r.error); return }
      setConfirming(false)
      router.refresh()
    })
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setConfirming((v) => !v)}
        className="rounded-md border border-dashed px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted/60"
      >
        Définir comme responsable
      </button>
      {confirming && (
        <div className="absolute left-0 top-full z-10 mt-1 w-72 space-y-1.5 rounded-lg border bg-card p-2.5 shadow-md">
          <p className="text-[11px] font-medium text-foreground">
            Définir {companyName} comme responsable de ce Point ?
          </p>
          <p className="text-[11px] text-muted-foreground">
            Cette action transformera une entreprise simplement citée dans les preuves en responsabilité structurée.
          </p>
          {error && <p className="text-[11px] text-red-600">{error}</p>}
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={submit} disabled={pending}
              className="inline-flex items-center gap-1 rounded-md bg-sky-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-sky-700 disabled:opacity-50">
              {pending && <Loader2 className="h-3 w-3 animate-spin" />} Confirmer
            </button>
            <button type="button" onClick={() => { setConfirming(false); setError(null) }} disabled={pending}
              className="rounded-md border px-2.5 py-1 text-[11px] hover:bg-muted/60 disabled:opacity-50">Annuler</button>
          </div>
        </div>
      )}
    </div>
  )
}
