'use client'

// « Réinitialiser le chantier » — n'apparaît QUE sur un chantier de recette.
// Le bouton supprime : il demande donc confirmation et NOMME ce qu'il va effacer.
// Un « Êtes-vous sûr ? » n'informe personne ; « 1 visite, 3 propositions » si.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, RotateCcw } from 'lucide-react'
import { resetSandboxSiteAction } from './sandbox-actions'

export function SandboxResetButton({ siteId }: { siteId: string }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function reset() {
    setBusy(true)
    setError(null)
    const res = await resetSandboxSiteAction({ site_id: siteId })
    setBusy(false)
    setConfirming(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    router.refresh()
  }

  if (confirming) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] text-muted-foreground">
          Effacer visites, actions, propositions et réserves ?
        </span>
        <button
          type="button"
          onClick={() => void reset()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Tout effacer
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={busy}
          className="rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          Annuler
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
      >
        <RotateCcw className="h-4 w-4" /> Réinitialiser le chantier
      </button>
      {error && <span className="text-[13px] text-rose-600">{error}</span>}
    </div>
  )
}
