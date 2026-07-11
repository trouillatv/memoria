/**
 * File IndexedDB des captures de VISITE (Lot B — « la capture ne bloque jamais »).
 *
 * Calque de lib/field/photo-queue.ts (file legacy des interventions), mais
 * DÉDIÉE aux médias lourds d'une visite terrain (photo / vidéo / vocal). On ne
 * touche pas à la file legacy : base et store séparés, zéro risque de régression
 * sur le flow intervention. On RÉUTILISE en revanche les primitives de backoff
 * exponentiel déjà éprouvées (nextRetryDelay / isReadyForRetry).
 *
 * Modèle : « fire and forget ». Le geste dépose le blob ici et rend la main
 * immédiatement ; l'UI affiche la capture en optimiste ; un drain de fond monte
 * en arrière-plan avec retry au retour du réseau. Une entry n'est JAMAIS
 * supprimée automatiquement : le média reste en sécurité sur l'appareil tant
 * qu'il n'est pas confirmé côté serveur.
 *
 * Idempotence : clientUuid (uuid v4) généré AVANT tout réseau, porté jusqu'au
 * serveur (visit_capture.client_uuid, mig 177) — un re-drain renvoie la capture
 * déjà créée au lieu d'en dupliquer une. Les gestes sans média (note /
 * vérification / position), quasi instantanés, restent en appel serveur direct
 * et ne passent pas par cette file.
 */

import { isReadyForRetry, nextRetryDelay } from '@/lib/field/photo-queue'

export { isReadyForRetry, nextRetryDelay }

const DB_NAME = 'memoria-field-visits'
const STORE_NAME = 'visit-capture-queue'
const DB_VERSION = 1

export type QueuedVisitKind = 'photo' | 'video' | 'vocal'

export interface QueuedVisitCapture {
  tempId: string
  /** Identité idempotente (uuid v4) — portée jusqu'à visit_capture.client_uuid. */
  clientUuid: string
  /** L'agent qui a déposé (anti cross-compte sur appareil partagé) : le drainer
   *  ne monte QUE les dépôts du compte actuellement connecté. Optionnel pour
   *  rétrocompat avec d'éventuelles entries déposées avant ce champ. */
  userId?: string
  reportId: string
  siteId: string
  /** Nom du chantier au moment du dépôt — pour que la file de sync affiche
   *  « Cuisine Petratiti · Photo » sans appel serveur. Optionnel (rétrocompat
   *  avec les entries déposées avant ce champ). */
  siteName?: string
  kind: QueuedVisitKind
  blob: Blob
  filename: string
  mimeType: string
  /** Position ponctuelle OPT-IN de l'observation (jamais une trace). */
  lat?: number | null
  lng?: number | null
  takenAt: number // epoch ms
  attempts: number
  lastAttemptAt?: number // epoch ms — pour la disponibilité au retry (backoff)
  lastError?: string
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
        store.createIndex('reportId', 'reportId', { unique: false })
        store.createIndex('takenAt', 'takenAt', { unique: false })
      }
    }
  })
  return dbPromise
}

export async function queueVisitCapture(
  input: Omit<QueuedVisitCapture, 'tempId' | 'attempts' | 'takenAt'>,
): Promise<QueuedVisitCapture> {
  const db = await openDb()
  const entry: QueuedVisitCapture = {
    tempId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    takenAt: Date.now(),
    attempts: 0,
    ...input,
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const req = tx.objectStore(STORE_NAME).add(entry)
    req.onsuccess = () => resolve(entry)
    req.onerror = () => reject(req.error)
  })
}

export async function listQueuedVisitCaptures(): Promise<QueuedVisitCapture[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).getAll()
    req.onsuccess = () => resolve((req.result as QueuedVisitCapture[]) ?? [])
    req.onerror = () => reject(req.error)
  })
}

export async function listQueuedVisitCapturesByReport(reportId: string): Promise<QueuedVisitCapture[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const idx = tx.objectStore(STORE_NAME).index('reportId')
    const req = idx.getAll(reportId)
    req.onsuccess = () => resolve((req.result as QueuedVisitCapture[]) ?? [])
    req.onerror = () => reject(req.error)
  })
}

/** Compte les captures encore en attente d'envoi pour une visite (badge « N en attente »). */
export async function countQueuedVisitCapturesByReport(reportId: string): Promise<number> {
  const all = await listQueuedVisitCapturesByReport(reportId)
  return all.length
}

export async function removeQueuedVisitCapture(tempId: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const req = tx.objectStore(STORE_NAME).delete(tempId)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

/**
 * Reset `lastAttemptAt` sur toutes les entries pour les rendre immédiatement
 * éligibles au retry (symétrique de `markAllReadyForRetry` de la file photos).
 * Utilisé par le bouton « Re-essayer maintenant » de la sheet de sync, qui
 * relance les DEUX files. `attempts` reste inchangé (informatif pour l'UI).
 */
export async function markAllQueuedVisitCapturesReadyForRetry(): Promise<number> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const req = store.getAll()
    req.onsuccess = () => {
      const all = (req.result as QueuedVisitCapture[]) ?? []
      let pending = all.length
      if (pending === 0) return resolve(0)
      for (const entry of all) {
        const putReq = store.put({ ...entry, lastAttemptAt: undefined })
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

export async function updateQueuedVisitCapture(
  tempId: string,
  patch: Partial<QueuedVisitCapture>,
): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const getReq = store.get(tempId)
    getReq.onsuccess = () => {
      const existing = getReq.result as QueuedVisitCapture | undefined
      if (!existing) return resolve()
      const putReq = store.put({ ...existing, ...patch })
      putReq.onsuccess = () => resolve()
      putReq.onerror = () => reject(putReq.error)
    }
    getReq.onerror = () => reject(getReq.error)
  })
}
