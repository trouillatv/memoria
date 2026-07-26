'use client'

import { useState, useTransition } from 'react'
import { RotateCcw, Loader2 } from 'lucide-react'
import { resetEngagementsAction } from '../engagements-actions'

// Réinitialise les engagements extraits pour relancer l'extraction (qui refuse
// tant qu'il en existe). Geste secondaire et discret, avec confirmation : il
// supprime des données. Les engagements convertis en contrat sont conservés
// (garde côté serveur) — le message le rappelle.
export function ResetEngagementsButton({ tenderId }: { tenderId: string }) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function onSubmit(formData: FormData) {
    if (!confirm('Réinitialiser les engagements de ce dossier ?\n\nLes engagements extraits seront supprimés pour permettre une nouvelle extraction. Les engagements déjà rattachés à un contrat sont conservés.')) return
    setError(null)
    startTransition(async () => {
      const res = await resetEngagementsAction(formData)
      if (res && 'error' in res) setError(res.error)
    })
  }

  return (
    <form action={onSubmit} className="flex flex-col items-end gap-1">
      <input type="hidden" name="tender_id" value={tenderId} />
      <button
        type="submit"
        disabled={isPending}
        className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors disabled:opacity-60"
      >
        {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
        {isPending ? 'Réinitialisation…' : 'Réinitialiser les engagements'}
      </button>
      {error && <p className="max-w-xs text-right text-xs text-destructive">{error}</p>}
    </form>
  )
}
