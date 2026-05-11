'use client'

import { useEffect, useState, useCallback } from 'react'
import { listQueuedPhotos, type QueuedPhoto } from './photo-queue'

export type SyncState = 'green' | 'yellow' | 'red' | 'unknown'

export interface SyncStatus {
  state: SyncState
  pendingCount: number
  hasErrors: boolean
}

const POLL_INTERVAL_MS = 5_000

function deriveState(queue: QueuedPhoto[]): SyncStatus {
  if (queue.length === 0) {
    return { state: 'green', pendingCount: 0, hasErrors: false }
  }
  const hasErrors = queue.some((q) => q.attempts >= 3)
  if (hasErrors) {
    return { state: 'red', pendingCount: queue.length, hasErrors: true }
  }
  return { state: 'yellow', pendingCount: queue.length, hasErrors: false }
}

export function useSyncStatus(): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>({
    state: 'unknown',
    pendingCount: 0,
    hasErrors: false,
  })

  const refresh = useCallback(async () => {
    try {
      const queue = await listQueuedPhotos()
      setStatus(deriveState(queue))
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
 * Hook qui retourne le détail des entries en queue (slice A.1).
 * Utilisé par la PhotoQueueSheet pour afficher la liste des photos en attente.
 * Rafraîchit à la même cadence que useSyncStatus (5s).
 */
export function useQueueEntries(): {
  entries: QueuedPhoto[]
  refresh: () => Promise<void>
} {
  const [entries, setEntries] = useState<QueuedPhoto[]>([])

  const refresh = useCallback(async () => {
    try {
      const queue = await listQueuedPhotos()
      // Tri stable : plus récent en haut.
      queue.sort((a, b) => b.takenAt - a.takenAt)
      setEntries(queue)
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
