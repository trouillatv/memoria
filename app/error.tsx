'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Log côté client pour debug. En prod, brancher Sentry ici.
    console.error('[app error]', error)
  }, [error])

  return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-background">
      <div className="text-center max-w-md">
        <div className="flex items-center justify-center rounded-full bg-amber-50 text-amber-700 border border-amber-200 h-16 w-16 mb-6 mx-auto">
          <AlertTriangle className="h-7 w-7" strokeWidth={1.5} />
        </div>
        <h1 className="text-xl font-semibold mb-2">Quelque chose s&apos;est passé</h1>
        <p className="text-sm text-muted-foreground mb-2">
          Une erreur inattendue est survenue. Vos données et vos preuves sont en sécurité.
        </p>
        {error.digest && (
          <p className="text-xs text-muted-foreground/70 mb-6 font-mono">
            Référence : {error.digest}
          </p>
        )}
        <div className="flex flex-col sm:flex-row gap-2 items-center justify-center">
          <Button onClick={reset}>
            <RotateCcw className="h-4 w-4 mr-2" />
            Réessayer
          </Button>
          <Link href="/dashboard">
            <Button variant="outline">Retour au tableau de bord</Button>
          </Link>
        </div>
      </div>
    </div>
  )
}
