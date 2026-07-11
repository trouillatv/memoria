'use client'

/**
 * Sync indicator (header field).
 *
 * Cliquable → ouvre la file de synchronisation (toutes captures : photo, vocal,
 * vidéo…) et un bouton "Re-essayer maintenant".
 *
 * PR-1 — l'indicateur agrège désormais les DEUX files (photos legacy/spontanées
 * ET captures de visite). Avant, il ne comptait que les photos : une photo ou un
 * vocal de visite encore en cours d'envoi n'apparaissait pas, et « Tout est
 * envoyé » pouvait mentir. Le vocabulaire est neutralisé (« captures », plus
 * « photos »).
 *
 * Doctrine :
 *   - Visuel : point coloré green/yellow/red + label sobre.
 *   - Pas d'animation rouge clignotante anxiogène.
 *   - aria-label explicite ("Voir la file de synchronisation").
 */

import { useSyncStatus } from '@/lib/field/sync-status'
import { PhotoQueueSheet } from './photo-queue-sheet'

const LABELS = {
  green:   'Tout est envoyé',
  yellow:  'en attente',
  red:     'à renvoyer',
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
  const isPending = state === 'yellow' || state === 'red'

  const ariaLabel = isPending
    ? `${pendingCount} ${pendingCount > 1 ? 'captures en attente' : 'capture en attente'} d'envoi. Voir la file de synchronisation.`
    : 'Toutes vos captures sont synchronisées. Voir la file de synchronisation.'

  const tooltip = isPending
    ? `${pendingCount} ${pendingCount > 1 ? 'captures en attente' : 'capture en attente'} d'envoi`
    : 'Tout est synchronisé'

  return (
    <PhotoQueueSheet
      trigger={
        <button
          type="button"
          aria-label={ariaLabel}
          title={tooltip}
          data-testid="sync-indicator"
          className="text-xs text-muted-foreground inline-flex items-center gap-1.5 rounded-md px-2 py-1 -mx-2 -my-1 active:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-live="polite"
        >
          <span
            className={`inline-block w-2 h-2 rounded-full ${COLORS[state]}`}
            aria-hidden
          />
          <span className="tabular-nums">
            {state === 'green' || state === 'unknown'
              ? label
              : `${pendingCount} ${label.toLowerCase()}`}
          </span>
        </button>
      }
    />
  )
}
