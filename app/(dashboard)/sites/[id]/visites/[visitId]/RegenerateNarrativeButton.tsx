'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { regenerateNarrativeAction } from './narrative-actions'

export function RegenerateNarrativeButton({
  siteReportId,
  runId,
}: {
  siteReportId: string
  runId: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleClick() {
    setError(null)
    const fd = new FormData()
    fd.set('site_report_id', siteReportId)
    fd.set('run_id', runId)
    startTransition(async () => {
      const result = await regenerateNarrativeAction(fd)
      if (result.ok) {
        router.refresh()
      } else {
        setError(result.error ?? 'Erreur')
      }
    })
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="text-[12px] text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50 transition-colors"
      >
        {isPending ? 'Génération en cours…' : 'Régénérer le résumé'}
      </button>
      {error && <p className="mt-0.5 text-[11px] text-destructive">{error}</p>}
    </div>
  )
}
