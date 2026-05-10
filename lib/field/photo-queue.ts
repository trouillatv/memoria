/**
 * IndexedDB-backed photo queue for the mobile agent app.
 *
 * Stores photos that haven't been uploaded yet (or failed and need retry).
 * Each entry: { tempId, blob, interventionId, checklistItemId, kind, takenAt, attempts }
 *
 * The queue is "fire and forget" — UI shows the photo immediately from local
 * cache, the queue handles upload silently in the background.
 *
 * NOT a full PWA / offline-first system. Just a robust queue for unreliable mobile networks.
 */

const DB_NAME = 'netoiage-field'
const STORE_NAME = 'photo-queue'
const DB_VERSION = 1

export interface QueuedPhoto {
  tempId: string
  blob: Blob
  filename: string
  mimeType: string
  interventionId: string
  checklistItemId: string | null
  kind: 'before' | 'after' | 'anomaly' | 'proof'
  takenAt: number   // epoch ms
  attempts: number
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
  const db = await openDb()
  const entry: QueuedPhoto = {
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

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}
