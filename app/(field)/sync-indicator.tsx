'use client'

import { useSyncStatus } from '@/lib/field/sync-status'

const LABELS = {
  green:   'Tout est envoyé',
  yellow:  'Photos en attente',
  red:     'À renvoyer',
  unknown: 'Synchronisation',
} as const

const COLORS = {
  green:   'bg-emerald-500',
  yellow:  'bg-amber-400',
  red:     'bg-rose-500',
  unknown: 'bg-muted-foreground/40',
} as const

export function SyncIndicator() {
  const { state, pendingCount } = useSyncStatus()
  const label = LABELS[state]

  return (
    <div
      className="text-xs text-muted-foreground inline-flex items-center gap-1.5"
      aria-live="polite"
    >
      <span className={`inline-block w-2 h-2 rounded-full ${COLORS[state]}`} aria-hidden />
      <span className="tabular-nums">
        {state === 'green' || state === 'unknown'
          ? label
          : `${pendingCount} ${label.toLowerCase()}`}
      </span>
    </div>
  )
}
