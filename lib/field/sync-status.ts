'use client'

import { useEffect, useState, useCallback } from 'react'
import { listQueuedPhotos, type QueuedPhoto } from './photo-queue'
import {
  listQueuedVisitCaptures,
  type QueuedVisitCapture,
} from './visit-capture-queue'

export type SyncState = 'green' | 'yellow' | 'red' | 'unknown'

export interface SyncStatus {
  state: SyncState
  pendingCount: number
  hasErrors: boolean
}

/** File d'origine d'une entry — détermine où router retry / suppression. */
export type QueueSource = 'photo' | 'visit'

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
  takenAt: number
  attempts: number
  lastAttemptAt?: number
  lastError?: string
}

const POLL_INTERVAL_MS = 5_000

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
  return [...fromPhotos, ...fromVisits]
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
  return toUnified(photos, visits)
}

function deriveState(entries: Array<{ attempts: number }>): SyncStatus {
  if (entries.length === 0) {
    return { state: 'green', pendingCount: 0, hasErrors: false }
  }
  const hasErrors = entries.some((q) => q.attempts >= 3)
  if (hasErrors) {
    return { state: 'red', pendingCount: entries.length, hasErrors: true }
  }
  return { state: 'yellow', pendingCount: entries.length, hasErrors: false }
}

export function useSyncStatus(): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>({
    state: 'unknown',
    pendingCount: 0,
    hasErrors: false,
  })

  const refresh = useCallback(async () => {
    try {
      const entries = await loadUnified()
      setStatus(deriveState(entries))
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
  refresh: () => Promise<void>
} {
  const [entries, setEntries] = useState<UnifiedQueueEntry[]>([])

  const refresh = useCallback(async () => {
    try {
      const all = await loadUnified()
      // Tri stable : plus récent en haut.
      all.sort((a, b) => b.takenAt - a.takenAt)
      setEntries(all)
    } catch (e) {
      console.error('[useQueueEntries]', e)
    }
  }, [])

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [refresh])

  return { entries, refresh }
}
