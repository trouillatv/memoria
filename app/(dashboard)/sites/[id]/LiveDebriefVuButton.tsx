'use client'

// D4 — bouton « Vu » pour un signal informationnel du Débrief vivant, en
// production (surface « À savoir avant d'y aller »). Réplique le pattern de
// app/(dashboard)/dev/live-debrief/MarkSeenButton.tsx (D3, non modifié), mais
// prévient le parent via `onSeen` plutôt que `router.refresh()` : le brief est
// ici un état client (`useState`), pas une page server-rendue.
//
// Type-locked à `LiveDebriefInformationalItem` (comme markLiveDebriefSignalSeen
// côté serveur) : jamais de « Vu » sur une Action/Échéance/Réserve.

import { useTransition } from 'react'
import { toast } from 'sonner'
import type { LiveDebriefInformationalItem } from '@/lib/knowledge/live-debrief'
import { markLiveDebriefSignalSeenAction } from './live-debrief-signal-actions'

export function LiveDebriefVuButton({
  item,
  siteId,
  onSeen,
}: {
  item: LiveDebriefInformationalItem
  siteId: string
  onSeen: () => void
}) {
  const [pending, startTransition] = useTransition()

  function onClick() {
    startTransition(async () => {
      const result = await markLiveDebriefSignalSeenAction(item, siteId)
      if (result.ok) onSeen()
      else toast.error(result.error ?? 'Échec')
    })
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="shrink-0 rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
    >
      {pending ? '…' : 'Vu'}
    </button>
  )
}
