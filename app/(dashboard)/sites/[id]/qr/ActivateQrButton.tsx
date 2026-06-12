'use client'

import { useTransition } from 'react'
import { Loader2, QrCode } from 'lucide-react'
import { activateQrAction } from './actions'

export function ActivateQrButton({ siteId }: { siteId: string }) {
  const [isPending, startTransition] = useTransition()

  return (
    <button
      onClick={() => startTransition(() => activateQrAction(siteId))}
      disabled={isPending}
      className="inline-flex items-center gap-2 rounded-md bg-foreground text-background px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
    >
      {isPending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <QrCode className="h-4 w-4" />
      )}
      Générer le QR Code
    </button>
  )
}
