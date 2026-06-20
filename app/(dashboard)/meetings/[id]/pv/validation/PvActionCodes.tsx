'use client'

// Colonne ACTION d'un point examiné (mig 132) : « qui doit faire quoi ».
// Multi-sélection de codes responsables BECIB (ETV/MOA/MOE/FSH/CLUB). La valeur
// est MÉMORISÉE sur la source du point (pas juste le PDF) → CR suivant / recherche
// / relances la retrouvent. Cliquer une puce = bascule immédiate + re-rendu CR.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { setPointActionsAction } from '../../pv-actions'
import { ACTION_CODES } from '@/lib/db/action-codes'

export function PvActionCodes({
  reportId,
  source,
  codes,
}: {
  reportId: string
  source: string
  codes: string[]
}) {
  const router = useRouter()
  const [selected, setSelected] = useState<string[]>(codes)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function toggle(code: string) {
    const next = selected.includes(code) ? selected.filter((c) => c !== code) : [...selected, code]
    setSelected(next) // optimiste (la mémoire reste la vérité, le serveur re-rend)
    setError(null)
    startTransition(async () => {
      try {
        const res = await setPointActionsAction(reportId, source, next)
        if (res.ok) router.refresh()
        else { setError(res.error); setSelected(codes) }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erreur serveur.')
        setSelected(codes)
      }
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="mr-1 text-[10px] uppercase tracking-wide text-muted-foreground">Action</span>
      {ACTION_CODES.map((code) => {
        const on = selected.includes(code)
        return (
          <button
            key={code}
            type="button"
            onClick={() => toggle(code)}
            disabled={pending}
            aria-pressed={on}
            className={`rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-50 ${
              on
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground'
            }`}
          >
            {code}
          </button>
        )
      })}
      {pending && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      {error && <span className="text-[11px] text-rose-600">{error}</span>}
    </div>
  )
}
