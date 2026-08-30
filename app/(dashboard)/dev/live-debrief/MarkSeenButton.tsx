'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { LiveDebriefInformationalItem } from '@/lib/knowledge/live-debrief'
import { markLiveDebriefSignalSeenAction } from './live-debrief-actions'

// `invalidateSiteProjection` (appelé par markLiveDebriefSignalSeen) revalide
// /sites/[id], pas cette page de debug — router.refresh() force la relecture
// serveur ici pour observer l'effet (D3 §7 : pas de nouveau cache).
export function MarkSeenButton({ item, siteId }: { item: LiveDebriefInformationalItem; siteId: string }) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function onClick() {
    startTransition(async () => {
      const result = await markLiveDebriefSignalSeenAction(item, siteId)
      if (result.ok) router.refresh()
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
