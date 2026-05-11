/**
 * Sync events bus (Slice A.1).
 *
 * EventTarget-based event bus pour notifier les succès/échecs de sync
 * de photos vers le serveur. Utilisé par le toast réassurant du layout
 * mobile pour confirmer à l'agent que ses photos sont bien parties.
 *
 * Doctrine de réassurance :
 *   - Le bus diffuse "X photos synchronisées" (positif).
 *   - Pour les échecs répétés, le wording reste calme ("Connexion lente —
 *     re-essai dans X minutes"), JAMAIS d'alarme ou de "FAILURE".
 *   - Pas de notification push (anti-anxiété).
 *
 * Côté serveur, le bus n'est pas instancié (window indisponible) — les
 * fonctions `emit/subscribe` deviennent des no-ops sûrs.
 */

export type SyncEvent =
  | { type: 'sync_success'; count: number }
  | { type: 'sync_failure'; attempts: number }

const EVENT_NAME = 'netoiage-sync-event'

const bus: EventTarget | null =
  typeof window !== 'undefined' ? new EventTarget() : null

interface SyncCustomEvent extends Event {
  detail?: SyncEvent
}

export function emitSyncEvent(ev: SyncEvent): void {
  if (!bus) return
  const custom: SyncCustomEvent = new Event(EVENT_NAME)
  custom.detail = ev
  bus.dispatchEvent(custom)
}

export function subscribeSync(handler: (ev: SyncEvent) => void): () => void {
  if (!bus) return () => {}
  const listener = (e: Event) => {
    const detail = (e as SyncCustomEvent).detail
    if (detail) handler(detail)
  }
  bus.addEventListener(EVENT_NAME, listener)
  return () => bus.removeEventListener(EVENT_NAME, listener)
}
