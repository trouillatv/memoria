/**
 * IndexedDB-backed photo queue for the mobile agent app.
 *
 * Stores photos that haven't been uploaded yet (or failed and need retry).
 *
 * Deux modes (V5.1) :
 *   - **legacy** : entry liée à une intervention pré-planifiée
 *     ({ interventionId, checklistItemId, kind: 'before|after|anomaly|proof' })
 *   - **spontané** : entry liée à un site (trace libre hors workflow planifié)
 *     ({ siteId, intent: 'passage'|'anomaly', kind: 'passage'|'anomaly', clientUuid })
 *
 * Le drain (use-photo-uploader) route vers la bonne server action selon le mode.
 *
 * The queue is "fire and forget" — UI shows the photo immediately from local
 * cache, the queue handles upload silently in the background.
 *
 * NOT a full PWA / offline-first system. Just a robust queue for unreliable mobile networks.
 *
 * Slice A.1 — Backoff exponential :
 *   attempts 0 → retry in 1s
 *   attempts 1 → 5s
 *   attempts 2 → 30s
 *   attempts 3 → 2min
 *   attempts 4 → 10min
 *   attempts 5 → 30min
 *   attempts 6+ → 1h (capped)
 *
 * On ne supprime JAMAIS automatiquement une entry, même après 6 tentatives.
 * Les photos restent en sécurité sur l'appareil tant qu'elles ne sont pas envoyées.
 *
 * V5.1 (2026-05-14) — ajout des champs siteId, intent, clientUuid pour le
 * mode spontané. clientUuid sert d'identité idempotente côté serveur
 * (ON CONFLICT DO NOTHING sur intervention_photos.client_uuid, migration 051).
 */

const DB_NAME = 'memoria-field'
const STORE_NAME = 'photo-queue'
const DB_VERSION = 1

export type PhotoKind = 'before' | 'after' | 'anomaly' | 'proof' | 'passage'

export interface QueuedPhoto {
  tempId: string
  blob: Blob
  filename: string
  mimeType: string
  /** Mode legacy : intervention pré-planifiée. Mutuellement exclusif avec siteId. */
  interventionId?: string
  checklistItemId: string | null
  /** FK vers une anomalie existante (migration 066). Optionnel — mode legacy uniquement. */
  anomalyId?: string | null
  /** Mode spontané (V5.1) : trace libre sur un site. Mutuellement exclusif avec interventionId. */
  siteId?: string
  /** Mode spontané (V5.1) : nature de la trace (passage banal / anomalie). */
  intent?: 'passage' | 'anomaly'
  kind: PhotoKind
  takenAt: number   // epoch ms
  attempts: number
  lastAttemptAt?: number  // epoch ms — used for backoff readiness
  lastError?: string
  /** V5.1 : UUID v4 généré côté client, sert d'idempotence côté serveur.
   *  Optionnel pour rétrocompat avec entries legacy en queue avant V5.1. */
  clientUuid?: string
}

/** Discriminant côté drain : retourne le mode de l'entry. */
export function queuedPhotoMode(p: QueuedPhoto): 'legacy' | 'spontaneous' | 'invalid' {
  if (p.interventionId && !p.siteId) return 'legacy'
  if (p.siteId && !p.interventionId) return 'spontaneous'
  return 'invalid'
}

// Backoff progression (ms). Index = number of failed attempts so far.
// Capped at the last value once attempts >= length - 1.
export const BACKOFF_DELAYS_MS = [
  1_000,         // attempt 0 → retry in 1s
  5_000,         // attempt 1 → 5s
  30_000,        // attempt 2 → 30s
  120_000,       // attempt 3 → 2min
  600_000,       // attempt 4 → 10min
  1_800_000,     // attempt 5 → 30min
  3_600_000,     // attempt 6+ → 1h (capped)
]

/**
 * Delay (ms) à attendre avant la prochaine tentative, en fonction du
 * nombre de tentatives déjà effectuées. Capped à 1h.
 */
export function nextRetryDelay(attempts: number): number {
  if (attempts < 0 || !Number.isFinite(attempts)) return BACKOFF_DELAYS_MS[0]
  const idx = Math.min(Math.floor(attempts), BACKOFF_DELAYS_MS.length - 1)
  return BACKOFF_DELAYS_MS[idx]
}

/**
 * Une entry est prête pour un nouveau retry si :
 *   - elle n'a jamais été tentée (`lastAttemptAt` undefined), ou
 *   - le délai backoff exponentiel depuis la dernière tentative est écoulé.
 */
export function isReadyForRetry(entry: {
  attempts: number
  lastAttemptAt?: number
}): boolean {
  if (entry.lastAttemptAt == null) return true
  const delay = nextRetryDelay(entry.attempts)
  return Date.now() - entry.lastAttemptAt >= delay
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('IndexedDB only available client-side'))
  }
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'tempId' })
        store.createIndex('interventionId', 'interventionId', { unique: false })
        store.createIndex('takenAt', 'takenAt', { unique: false })
      }
    }
  })
  return dbPromise
}

export async function queuePhoto(
  input: Omit<QueuedPhoto, 'tempId' | 'attempts' | 'takenAt'>
): Promise<QueuedPhoto> {
  // Garde-fou XOR : exactement un des deux modes (legacy intervention OU
  // spontané site). Sinon erreur immédiate côté caller — empêche les entries
  // ambiguës d'entrer dans la queue.
  const hasIntervention = !!input.interventionId
  const hasSite = !!input.siteId
  if (hasIntervention === hasSite) {
    throw new Error(
      `queuePhoto: il faut exactement un de (interventionId, siteId). Reçu : ` +
      `interventionId=${input.interventionId ?? 'null'}, siteId=${input.siteId ?? 'null'}.`
    )
  }

  // V5.1 — pour le mode spontané, générer un clientUuid v4 si non fourni par
  // le caller. Sert d'idempotence côté serveur (ON CONFLICT sur
  // intervention_photos.client_uuid, migration 051).
  // crypto.randomUUID() est dispo en client moderne ; fallback inline si absent.
  let clientUuid = input.clientUuid
  if (hasSite && !clientUuid) {
    clientUuid = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
  }

  const db = await openDb()
  const entry: QueuedPhoto = {
    tempId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    takenAt: Date.now(),
    attempts: 0,
    ...input,
    clientUuid,
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const req = tx.objectStore(STORE_NAME).add(entry)
    req.onsuccess = () => resolve(entry)
    req.onerror = () => reject(req.error)
  })
}

export async function listQueuedPhotos(): Promise<QueuedPhoto[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).getAll()
    req.onsuccess = () => resolve((req.result as QueuedPhoto[]) ?? [])
    req.onerror = () => reject(req.error)
  })
}

export async function listQueuedPhotosByIntervention(
  interventionId: string
): Promise<QueuedPhoto[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const idx = tx.objectStore(STORE_NAME).index('interventionId')
    const req = idx.getAll(interventionId)
    req.onsuccess = () => resolve((req.result as QueuedPhoto[]) ?? [])
    req.onerror = () => reject(req.error)
  })
}

export async function removeQueuedPhoto(tempId: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const req = tx.objectStore(STORE_NAME).delete(tempId)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

export async function updateQueuedPhoto(
  tempId: string,
  patch: Partial<QueuedPhoto>
): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const getReq = store.get(tempId)
    getReq.onsuccess = () => {
      const existing = getReq.result as QueuedPhoto | undefined
      if (!existing) return resolve()
      const updated = { ...existing, ...patch }
      const putReq = store.put(updated)
      putReq.onsuccess = () => resolve()
      putReq.onerror = () => reject(putReq.error)
    }
    getReq.onerror = () => reject(getReq.error)
  })
}

/**
 * Reset `lastAttemptAt` à `undefined` sur toutes les entries de la queue afin
 * qu'elles redeviennent immédiatement éligibles à un retry (sans réinitialiser
 * le compteur `attempts`, qui reste informatif pour l'UI).
 * Utilisé par le bouton "Re-essayer maintenant" de la sheet.
 */
export async function markAllReadyForRetry(): Promise<number> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const req = store.getAll()
    req.onsuccess = () => {
      const all = (req.result as QueuedPhoto[]) ?? []
      let pending = all.length
      if (pending === 0) return resolve(0)
      for (const entry of all) {
        const updated: QueuedPhoto = { ...entry, lastAttemptAt: undefined }
        const putReq = store.put(updated)
        putReq.onsuccess = () => {
          pending -= 1
          if (pending === 0) resolve(all.length)
        }
        putReq.onerror = () => reject(putReq.error)
      }
    }
    req.onerror = () => reject(req.error)
  })
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}
