'use client'

import { useEffect, useState, useTransition } from 'react'
import { Loader2 } from 'lucide-react'
import { extractEngagementsAction } from '../engagements-actions'

// Durée typique de l'extraction (lecture AO + mémoire technique → 20-30 engagements).
const EXPECTED_SECONDS = 30

export function ExtractEngagementsButton({ tenderId }: { tenderId: string }) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)

  // Compteur de temps écoulé pendant l'extraction (alimente la barre).
  useEffect(() => {
    if (!isPending) return
    setElapsed(0)
    const t = setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => clearInterval(t)
  }, [isPending])

  async function onSubmit(formData: FormData) {
    setError(null)
    startTransition(async () => {
      const res = await extractEngagementsAction(formData)
      if (res && 'error' in res) setError(res.error)
    })
  }

  // Progression vers ~95 % calée sur la durée typique, puis attend la vraie fin.
  const pct = Math.min(95, Math.round((1 - Math.exp(-elapsed / (EXPECTED_SECONDS / 1.6))) * 100))
  const remaining = Math.max(0, EXPECTED_SECONDS - elapsed)

  return (
    <form action={onSubmit} className="flex flex-col items-end gap-2 w-full max-w-xs">
      <input type="hidden" name="tender_id" value={tenderId} />
      <button
        type="submit"
        disabled={isPending}
        className="px-3 py-1.5 rounded border bg-foreground text-background text-sm hover:opacity-90 disabled:opacity-60 inline-flex items-center gap-1.5"
      >
        {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {isPending ? 'Extraction…' : 'Extraire les engagements (IA)'}
      </button>

      {isPending && (
        <div className="w-full space-y-1">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-[11px] text-muted-foreground text-right tabular-nums">
            {remaining > 0 ? `~${remaining}s — lecture du dossier et de la mémoire technique` : 'bientôt prêt…'}
          </p>
        </div>
      )}

      {error && <p className="text-xs text-destructive text-right">{error}</p>}
    </form>
  )
}
