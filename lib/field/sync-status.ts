'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  listQueuedPhotos,
  markAllReadyForRetry,
  removeQueuedPhoto,
  type QueuedPhoto,
} from './photo-queue'
import {
  listQueuedVisitCaptures,
  markAllVisitCapturesReadyForRetry,
  removeQueuedVisitCapture,
  type QueuedVisitCapture,
} from './visit-capture-queue'
import {
  snapshotLiveUploads,
  subscribeLiveUploads,
  useLiveUploads,
  type LiveUpload,
} from './live-uploads'

export type SyncState = 'green' | 'yellow' | 'red' | 'unknown'

export interface SyncStatus {
  state: SyncState
  pendingCount: number
  hasErrors: boolean
}

const POLL_INTERVAL_MS = 5_000

/** Une entry en attente, tous canaux confondus (file legacy, file visite, upload direct). */
export type PendingSource = 'legacy' | 'visit' | 'live'

export interface PendingEntry {
  /** Clé de liste stable. */
  key: string
  source: PendingSource
  /** Libellé humain (« Photo », « Vidéo », « Mémo vocal », « Photo avant »…). */
  label: string
  takenAt: number
  attempts: number
  lastAttemptAt?: number
  /** Source de vignette : blob (files IndexedDB) ou objectURL (upload direct). */
  thumbBlob?: Blob
  thumbUrl?: string | null
  /** Un upload direct en cours ne peut être ni relancé ni supprimé manuellement. */
  deletable: boolean
  // Identifiants internes pour router la suppression vers la bonne file.
  legacyTempId?: string
  visitTempId?: string
}

const LEGACY_KIND_LABELS: Record<QueuedPhoto['kind'], string> = {
  before: 'Photo avant',
  after: 'Photo après',
  anomaly: 'Photo anomalie',
  proof: 'Photo preuve',
  passage: 'Photo passage',
  access: 'Photo accès',
}

const VISIT_KIND_LABELS: Record<QueuedVisitCapture['kind'], string> = {
  photo: 'Photo',
  video: 'Vidéo',
  vocal: 'Mémo vocal',
}

function mapLegacy(p: QueuedPhoto): PendingEntry {
  return {
    key: `legacy:${p.tempId}`,
    source: 'legacy',
    label: LEGACY_KIND_LABELS[p.kind] ?? 'Photo',
    takenAt: p.takenAt,
    attempts: p.attempts,
    lastAttemptAt: p.lastAttemptAt,
    thumbBlob: p.blob,
    deletable: true,
    legacyTempId: p.tempId,
  }
}

function mapVisit(c: QueuedVisitCapture): PendingEntry {
  return {
    key: `visit:${c.tempId}`,
    source: 'visit',
    label: VISIT_KIND_LABELS[c.kind] ?? 'Capture',
    takenAt: c.takenAt,
    attempts: c.attempts,
    lastAttemptAt: c.lastAttemptAt,
    thumbBlob: c.blob,
    deletable: true,
    visitTempId: c.tempId,
  }
}

function mapLive(u: LiveUpload): PendingEntry {
  return {
    key: `live:${u.id}`,
    source: 'live',
    label: 'Vidéo',
    takenAt: u.takenAt,
    attempts: 0,
    thumbUrl: u.previewUrl,
    deletable: false,
  }
}

/** État agrégé (couleur + total) à partir des trois canaux. Exporté pour tests. */
export function deriveState(
  legacy: QueuedPhoto[],
  visit: QueuedVisitCapture[],
  liveCount: number,
): SyncStatus {
  const total = legacy.length + visit.length + liveCount
  if (total === 0) {
    return { state: 'green', pendingCount: 0, hasErrors: false }
  }
  const hasErrors =
    legacy.some((q) => q.attempts >= 3) || visit.some((q) => q.attempts >= 3)
  return {
    state: hasErrors ? 'red' : 'yellow',
    pendingCount: total,
    hasErrors,
  }
}

/** Lecture défensive d'une file : une base indisponible ne doit pas casser l'autre. */
async function safeList<T>(fn: () => Promise<T[]>): Promise<T[]> {
  try {
    return await fn()
  } catch {
    return []
  }
}

export function useSyncStatus(): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>({
    state: 'unknown',
    pendingCount: 0,
    hasErrors: false,
  })

  const refresh = useCallback(async () => {
    const [legacy, visit] = await Promise.all([
      safeList(listQueuedPhotos),
      safeList(listQueuedVisitCaptures),
    ])
    setStatus(deriveState(legacy, visit, snapshotLiveUploads().length))
  }, [])

  useEffect(() => {
    void refresh()
    const interval = setInterval(() => void refresh(), POLL_INTERVAL_MS)
    // Réactif aux uploads directs (vidéo) qui n'ont pas de file à sonder.
    const unsub = subscribeLiveUploads(() => void refresh())
    return () => {
      clearInterval(interval)
      unsub()
    }
  }, [refresh])

  return status
}

/**
 * Détail unifié des éléments en attente (files legacy + visite + uploads directs).
 * Alimente la sheet ouverte depuis le SyncIndicator. Rafraîchit à la même cadence
 * que useSyncStatus (5 s) et réagit immédiatement aux uploads directs.
 */
export function useQueueEntries(): {
  entries: PendingEntry[]
  refresh: () => Promise<void>
  retryAll: () => Promise<void>
  remove: (entry: PendingEntry) => Promise<void>
} {
  const [queueEntries, setQueueEntries] = useState<PendingEntry[]>([])
  const live = useLiveUploads()

  const refresh = useCallback(async () => {
    const [legacy, visit] = await Promise.all([
      safeList(listQueuedPhotos),
      safeList(listQueuedVisitCaptures),
    ])
    setQueueEntries([...legacy.map(mapLegacy), ...visit.map(mapVisit)])
  }, [])

  useEffect(() => {
    void refresh()
    const interval = setInterval(() => void refresh(), POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [refresh])

  // Fusion files + uploads directs, tri stable : plus récent en haut.
  const entries = useMemo(() => {
    const merged = [...queueEntries, ...live.map(mapLive)]
    merged.sort((a, b) => b.takenAt - a.takenAt)
    return merged
  }, [queueEntries, live])

  const retryAll = useCallback(async () => {
    // On relance les deux files ; les uploads directs, eux, sont déjà en cours.
    await Promise.all([
      markAllReadyForRetry().catch(() => 0),
      markAllVisitCapturesReadyForRetry().catch(() => 0),
    ])
    await refresh()
  }, [refresh])

  const remove = useCallback(
    async (entry: PendingEntry) => {
      try {
        if (entry.legacyTempId) await removeQueuedPhoto(entry.legacyTempId)
        else if (entry.visitTempId) await removeQueuedVisitCapture(entry.visitTempId)
      } catch {
        /* suppression best-effort — la file ne se vide jamais d'elle-même */
      }
      await refresh()
    },
    [refresh],
  )

  return { entries, refresh, retryAll, remove }
}
