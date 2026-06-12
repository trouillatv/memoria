'use client'

import { useTransition } from 'react'
import { Loader2, Trash2 } from 'lucide-react'
import { revokeQrAction } from './actions'

export function RevokeQrButton({ siteId }: { siteId: string }) {
  const [isPending, startTransition] = useTransition()

  return (
    <button
      onClick={() => {
        if (!confirm('Révoquer ce QR Code ? Il ne sera plus accessible. Vous pourrez en générer un nouveau.')) return
        startTransition(() => revokeQrAction(siteId))
      }}
      disabled={isPending}
      className="inline-flex items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
    >
      {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
      Révoquer
    </button>
  )
}
