'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { uploadPhotoMobileAction } from './actions'
import {
  isReadyForRetry,
  listQueuedPhotos,
  removeQueuedPhoto,
  updateQueuedPhoto,
} from '@/lib/field/photo-queue'
import { emitSyncEvent } from '@/lib/field/sync-events'

/**
 * Slice A.1 — Backoff exponential + bus de sync events.
 *
 * Drain de la queue IndexedDB :
 *   - skip toute entry qui n'est pas encore "readyForRetry" (cf. backoff).
 *   - en cas d'upload OK → remove + agrège un compteur de succès.
 *   - en cas d'échec → update attempts + lastAttemptAt et émet sync_failure
 *     (utilisé par le toast "Connexion lente — re-essai dans X min").
 *   - à la fin du pass, si au moins 1 photo est partie → émet sync_success
 *     avec le total (1 seul toast pour "3 photos synchronisées").
 *
 * On ne supprime JAMAIS une entry après N échecs : les photos restent
 * stockées localement tant qu'elles ne sont pas envoyées.
 */
export function usePhotoUploader() {
  const router = useRouter()
  const [pendingCount, setPendingCount] = useState(0)
  const isUploadingRef = useRef(false)

  const sync = useCallback(async () => {
    if (isUploadingRef.current) return
    isUploadingRef.current = true
    try {
      const queue = await listQueuedPhotos()
      setPendingCount(queue.length)
      if (queue.length === 0) return

      let successCount = 0
      let lastFailureAttempts = 0
      let hadFailure = false

      // Upload sequentially (1 at a time) to avoid bandwidth saturation
      for (const photo of queue) {
        if (!isReadyForRetry(photo)) continue

        const attemptStartedAt = Date.now()
        try {
          const fd = new FormData()
          fd.set('intervention_id', photo.interventionId)
          fd.set('checklist_item_id', photo.checklistItemId ?? '')
          fd.set('kind', photo.kind)
          fd.set('file', new File([photo.blob], photo.filename, { type: photo.mimeType }))

          const r = await uploadPhotoMobileAction(fd)
          if (r && 'ok' in r && r.ok) {
            await removeQueuedPhoto(photo.tempId)
            successCount += 1
            router.refresh()
          } else {
            const errMsg = (r as { error?: string }).error ?? 'unknown'
            const nextAttempts = photo.attempts + 1
            await updateQueuedPhoto(photo.tempId, {
              attempts: nextAttempts,
              lastAttemptAt: attemptStartedAt,
              lastError: errMsg,
            })
            hadFailure = true
            lastFailureAttempts = Math.max(lastFailureAttempts, nextAttempts)
          }
        } catch (e) {
          const nextAttempts = photo.attempts + 1
          await updateQueuedPhoto(photo.tempId, {
            attempts: nextAttempts,
            lastAttemptAt: attemptStartedAt,
            lastError: e instanceof Error ? e.message : 'unknown',
          })
          hadFailure = true
          lastFailureAttempts = Math.max(lastFailureAttempts, nextAttempts)
        }
      }

      // Refresh pending count after pass
      const remaining = await listQueuedPhotos()
      setPendingCount(remaining.length)

      if (successCount > 0) {
        emitSyncEvent({ type: 'sync_success', count: successCount })
      }
      if (hadFailure) {
        emitSyncEvent({ type: 'sync_failure', attempts: lastFailureAttempts })
      }
    } finally {
      isUploadingRef.current = false
    }
  }, [router])

  useEffect(() => {
    // Trigger once on mount and then every 30 seconds
    void sync()
    const interval = setInterval(() => { void sync() }, 30_000)

    // Also trigger when network comes back online
    const handleOnline = () => { void sync() }
    window.addEventListener('online', handleOnline)

    return () => {
      clearInterval(interval)
      window.removeEventListener('online', handleOnline)
    }
  }, [sync])

  return { pendingCount, syncNow: sync }
}
