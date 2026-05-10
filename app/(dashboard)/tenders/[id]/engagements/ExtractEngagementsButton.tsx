'use client'

import { useState, useTransition } from 'react'
import { extractEngagementsAction } from '../engagements-actions'

export function ExtractEngagementsButton({ tenderId }: { tenderId: string }) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(formData: FormData) {
    setError(null)
    startTransition(async () => {
      const res = await extractEngagementsAction(formData)
      if (res && 'error' in res) setError(res.error)
    })
  }

  return (
    <form action={onSubmit} className="flex flex-col items-end gap-1">
      <input type="hidden" name="tender_id" value={tenderId} />
      <button
        type="submit"
        disabled={isPending}
        className="px-3 py-1.5 rounded border bg-foreground text-background text-sm hover:opacity-90 disabled:opacity-50"
      >
        {isPending ? 'Extraction…' : 'Extraire les engagements (IA)'}
      </button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </form>
  )
}
