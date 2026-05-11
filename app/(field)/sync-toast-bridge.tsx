'use client'

/**
 * Slice A.1 — Bridge entre le bus sync-events et Sonner.
 *
 * Écoute les événements `sync_success` / `sync_failure` et affiche un toast
 * sobre dans le layout mobile. Wording calme, anti-anxiété.
 *
 *   - sync_success → toast.success "✓ X photo(s) synchronisée(s)" (3 s)
 *   - sync_failure (attempts >= 3) → toast neutre "Connexion lente —
 *     re-essai dans X minutes", limité à 1 fois par session (anti-spam).
 *
 * Pas d'alerte agressive. Pas de notification push.
 */

import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import {
  subscribeSync,
  type SyncEvent,
} from '@/lib/field/sync-events'
import { nextRetryDelay } from '@/lib/field/photo-queue'

export function SyncToastBridge() {
  // Anti-spam : on ne montre le toast "connexion lente" qu'une fois par session.
  const slowConnectionWarnedRef = useRef(false)

  useEffect(() => {
    const handler = (ev: SyncEvent) => {
      if (ev.type === 'sync_success') {
        if (ev.count <= 0) return
        const label =
          ev.count === 1
            ? '1 photo synchronisée'
            : `${ev.count} photos synchronisées`
        toast.success(label, { duration: 3_000 })
        // Reset l'anti-spam dès qu'une sync réussit : la prochaine fois
        // qu'on perd le réseau, on peut prévenir à nouveau.
        slowConnectionWarnedRef.current = false
        return
      }

      if (ev.type === 'sync_failure' && ev.attempts >= 3) {
        if (slowConnectionWarnedRef.current) return
        slowConnectionWarnedRef.current = true
        const delayMs = nextRetryDelay(ev.attempts)
        const minutes = Math.max(1, Math.round(delayMs / 60_000))
        toast(`Connexion lente — re-essai dans ${minutes} min`, {
          duration: 4_000,
        })
      }
    }

    return subscribeSync(handler)
  }, [])

  return null
}
