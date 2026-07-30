'use client'

import { useEffect } from 'react'

export default function SiteError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[sites/[id]/error]', error)
  }, [error])

  return (
    <div className="mx-auto w-full max-w-[1180px] px-1 py-20">
      <div className="rounded-2xl border bg-card p-8 shadow-sm text-center space-y-4">
        <h1 className="text-xl font-semibold">Une erreur est survenue sur ce chantier</h1>
        <p className="text-sm text-muted-foreground">
          Vos données sont en sécurité. Essayez de recharger la page.
        </p>
        {(error.digest || error.message) && (
          <div className="font-mono text-xs text-muted-foreground border rounded px-3 py-2 bg-muted/40 text-left space-y-1 max-w-md mx-auto">
            {error.digest && <p>Code&nbsp;: {error.digest}</p>}
            {error.message && <p>Message&nbsp;: {error.message}</p>}
          </div>
        )}
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            type="button"
            onClick={reset}
            className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            Réessayer
          </button>
          <a href="/sites" className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90">
            Retour aux chantiers
          </a>
        </div>
      </div>
    </div>
  )
}
