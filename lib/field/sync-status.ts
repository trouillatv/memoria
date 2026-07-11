'use client'

import { useEffect, useState, useCallback } from 'react'
import { listQueuedPhotos, type QueuedPhoto } from './photo-queue'
import {
  listQueuedVisitCaptures,
  type QueuedVisitCapture,
} from './visit-capture-queue'
import { snapshotLiveUploads, type LiveUpload } from './live-uploads'

export type SyncState = 'green' | 'yellow' | 'red' | 'unknown'

export interface SyncStatus {
  state: SyncState
  pendingCount: number
  hasErrors: boolean
}

/** Canal d'origine d'une entry — détermine où router retry / suppression.
 *  'live' = upload direct (vidéo, #81) : ni relançable ni supprimable. */
export type QueueSource = 'photo' | 'visit' | 'live'

/**
 * Vue unifiée d'une capture en attente, quelle que soit sa file d'origine
 * (file legacy des photos d'intervention/spontanées OU file des captures de
 * visite). L'indicateur et la sheet raisonnent sur ce type unique — c'est ce
 * qui permet à la pastille de dire enfin la vérité : un vocal ou une photo de
 * visite encore en cours d'envoi COMPTE, alors qu'avant seule la file photos
 * était regardée.
 */
export interface UnifiedQueueEntry {
  tempId: string
  source: QueueSource
  /** Libellé du type de capture (« Photo », « Vocal », « Vidéo »…). */
  kindLabel: string
  /** Nom du chantier au moment du dépôt (si connu) — « Cuisine Petratiti ». */
  siteName?: string
  /** Nom de fichier local — utile pour identifier la capture en cas d'échec. */
  filename?: string
  /** Média local (absent pour un geste léger : note / vérification / position). */
  blob?: Blob
  /** Vignette déjà prête (upload direct : objectURL) — prime sur blob. */
  previewUrl?: string | null
  takenAt: number
  attempts: number
  lastAttemptAt?: number
  lastError?: string
}

const POLL_INTERVAL_MS = 5_000

// ── Activité d'envoi en direct (partagée drains → file de sync) ──────────────
// La file ne doit pas seulement COMPTER : elle RACONTE ce qui part. Les drains
// signalent l'élément en cours d'envoi et les derniers envois réussis ; la
// sheet les affiche (« envoi… », « ✓ envoyée à l'instant »). État de module :
// il n'a de sens que dans la session d'écran courante, aucune persistance.
export interface RecentlySent {
  kindLabel: string
  siteName?: string
  sentAt: number
}
const RECENT_TTL_MS = 45_000
let uploadingKey: string | null = null
let recent: RecentlySent[] = []

export function reportUploadStart(tempId: string): void {
  uploadingKey = tempId
}
export function reportUploadEnd(tempId: string): void {
  if (uploadingKey === tempId) uploadingKey = null
}
export function reportUploadSuccess(e: { kindLabel: string; siteName?: string }): void {
  recent = [{ ...e, sentAt: Date.now() }, ...recent].slice(0, 5)
}
export function getUploadActivity(): { uploadingKey: string | null; recentlySent: RecentlySent[] } {
  const cutoff = Date.now() - RECENT_TTL_MS
  recent = recent.filter((r) => r.sentAt >= cutoff)
  return { uploadingKey, recentlySent: [...recent] }
}

// Les photos (intervention + spontané) n'ont qu'une nature visuelle : « Photo ».
const PHOTO_KIND_LABEL = 'Photo'

const VISIT_KIND_LABELS: Record<QueuedVisitCapture['kind'], string> = {
  photo: 'Photo',
  video: 'Vidéo',
  vocal: 'Vocal',
  note: 'Note',
  verification: 'Vérification',
  position: 'Position',
}

function toUnified(
  photos: QueuedPhoto[],
  visits: QueuedVisitCapture[],
  lives: LiveUpload[] = [],
): UnifiedQueueEntry[] {
  const fromPhotos: UnifiedQueueEntry[] = photos.map((p) => ({
    tempId: p.tempId,
    source: 'photo',
    kindLabel: PHOTO_KIND_LABEL,
    siteName: p.siteName,
    filename: p.filename,
    blob: p.blob,
    takenAt: p.takenAt,
    attempts: p.attempts,
    lastAttemptAt: p.lastAttemptAt,
    lastError: p.lastError,
  }))
  const fromVisits: UnifiedQueueEntry[] = visits.map((v) => ({
    tempId: v.tempId,
    source: 'visit',
    kindLabel: VISIT_KIND_LABELS[v.kind] ?? 'Capture',
    siteName: v.siteName,
    filename: v.filename,
    blob: v.blob,
    takenAt: v.takenAt,
    attempts: v.attempts,
    lastAttemptAt: v.lastAttemptAt,
    lastError: v.lastError,
  }))
  // Uploads directs (vidéo, #81) : montent en ce moment même — pas de retry.
  const fromLives: UnifiedQueueEntry[] = lives.map((u) => ({
    tempId: `live:${u.id}`,
    source: 'live',
    kindLabel: 'Vidéo',
    previewUrl: u.previewUrl,
    takenAt: u.takenAt,
    attempts: 0,
  }))
  return [...fromPhotos, ...fromVisits, ...fromLives]
}

/**
 * Charge et fusionne les deux files. Chaque lecture est isolée par un catch :
 * si une file est indisponible (ex. IndexedDB absent en SSR/test), l'autre
 * reste comptée — on ne fait jamais mentir la pastille dans le sens rassurant
 * à cause d'une erreur technique.
 */
async function loadUnified(): Promise<UnifiedQueueEntry[]> {
  const [photos, visits] = await Promise.all([
    listQueuedPhotos().catch(() => [] as QueuedPhoto[]),
    listQueuedVisitCaptures().catch(() => [] as QueuedVisitCapture[]),
  ])
  return toUnified(photos, visits, snapshotLiveUploads())
}

/** Agrège les TROIS canaux (file photos, file visite, uploads directs) en un
 *  état de pastille. Un upload direct compte en attente mais ne met jamais la
 *  pastille en rouge (pas de compteur d'échec). Exporté pour les tests de
 *  régression de la #81. */
export function deriveState(
  photos: Array<{ attempts: number }>,
  visits: Array<{ attempts: number }>,
  liveCount: number,
): SyncStatus {
  const queued = [...photos, ...visits]
  const pendingCount = queued.length + Math.max(0, liveCount)
  if (pendingCount === 0) {
    return { state: 'green', pendingCount: 0, hasErrors: false }
  }
  const hasErrors = queued.some((q) => q.attempts >= 3)
  if (hasErrors) {
    return { state: 'red', pendingCount, hasErrors: true }
  }
  return { state: 'yellow', pendingCount, hasErrors: false }
}

export function useSyncStatus(): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>({
    state: 'unknown',
    pendingCount: 0,
    hasErrors: false,
  })

  const refresh = useCallback(async () => {
    try {
      const [photos, visits] = await Promise.all([
        listQueuedPhotos().catch(() => [] as QueuedPhoto[]),
        listQueuedVisitCaptures().catch(() => [] as QueuedVisitCapture[]),
      ])
      setStatus(deriveState(photos, visits, snapshotLiveUploads().length))
    } catch (e) {
      console.error('[useSyncStatus]', e)
    }
  }, [])

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [refresh])

  return status
}

/**
 * Hook qui retourne le détail des entries en attente, TOUTES files confondues.
 * Utilisé par la sheet de synchronisation. Rafraîchit à la même cadence que
 * useSyncStatus (5s).
 */
export function useQueueEntries(): {
  entries: UnifiedQueueEntry[]
  activity: { uploadingKey: string | null; recentlySent: RecentlySent[] }
  refresh: () => Promise<void>
} {
  const [entries, setEntries] = useState<UnifiedQueueEntry[]>([])
  const [activity, setActivity] = useState<{ uploadingKey: string | null; recentlySent: RecentlySent[] }>(
    { uploadingKey: null, recentlySent: [] },
  )

  const refresh = useCallback(async () => {
    try {
      const all = await loadUnified()
      // Tri stable : plus récent en haut.
      all.sort((a, b) => b.takenAt - a.takenAt)
      setEntries(all)
      setActivity(getUploadActivity())
    } catch (e) {
      console.error('[useQueueEntries]', e)
    }
  }, [])

  useEffect(() => {
    refresh()
    // Cadence resserrée : la file est OUVERTE quand ce hook tourne — l'activité
    // (« envoi… », « ✓ à l'instant ») doit se raconter presque en direct.
    const interval = setInterval(refresh, 2_000)
    return () => clearInterval(interval)
  }, [refresh])

  return { entries, activity, refresh }
}
