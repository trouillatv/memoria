'use client'

// Lot Entreprise citée → Responsable, finition (mandat Vincent 2026-09-14, retour recette) —
// geste symétrique de PointCitedCompanyPromote : retirer une désignation manuelle active.
// Confirmation enseigne la doctrine : le retrait est un geste purement structurel au niveau
// du Point, il ne touche jamais les responsables déjà fixés sur les actions/réserves liées.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { revokeResponsibleCompanyAction } from '@/app/(dashboard)/sites/[id]/tracked-point-responsible-company-actions'

export function PointResponsibleCompanyRevoke({
  siteId,
  pointId,
  designationId,
  companyName,
}: {
  siteId: string
  pointId: string
  designationId: string
  companyName: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function submit() {
    setError(null)
    startTransition(async () => {
      const r = await revokeResponsibleCompanyAction({ siteId, pointId, designationId })
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
        className="text-[11px] font-medium text-muted-foreground underline decoration-dotted hover:text-foreground"
      >
        Retirer
      </button>
      {confirming && (
        <div className="absolute right-0 top-full z-10 mt-1 w-72 max-w-[85vw] space-y-1.5 rounded-lg border bg-card p-2.5 shadow-md">
          <p className="text-[11px] font-medium text-foreground">
            Retirer {companyName} des responsables de ce Point ?
          </p>
          <p className="text-[11px] text-muted-foreground">
            Cela ne modifie pas les responsables des actions ou réserves liées.
          </p>
          {error && <p className="text-[11px] text-red-600">{error}</p>}
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={submit} disabled={pending}
              className="inline-flex items-center gap-1 rounded-md bg-red-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-red-700 disabled:opacity-50">
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
