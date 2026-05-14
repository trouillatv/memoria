'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { uploadPhotoMobileAction } from '@/app/(field)/m/intervention/[id]/actions'
import { uploadSpontaneousTraceAction } from '@/app/(field)/m/site/[siteId]/actions'
import {
  isReadyForRetry,
  listQueuedPhotos,
  removeQueuedPhoto,
  updateQueuedPhoto,
  queuedPhotoMode,
  type QueuedPhoto,
} from '@/lib/field/photo-queue'
import { emitSyncEvent } from '@/lib/field/sync-events'

/**
 * V5.1 (2026-05-14) — Hook unifié drain de la queue IndexedDB.
 *
 * Remonté de `app/(field)/m/intervention/[id]/use-photo-uploader.ts` vers
 * `lib/field/` pour servir deux contextes :
 *   - flow legacy intervention pré-planifiée
 *   - flow V5.1 trace spontanée libre sur un site
 *
 * Le routage se fait par photo via queuedPhotoMode() :
 *   - 'legacy'      → uploadPhotoMobileAction
 *   - 'spontaneous' → uploadSpontaneousTraceAction
 *   - 'invalid'     → log + skip (entry malformée, ne devrait pas arriver)
 *
 * Le backoff exponential, le bus sync_events, l'online-listener et
 * l'intervalle de 30s restent identiques au hook original. Aucune régression
 * sur le flow legacy attendue.
 */

type UploadResult = { ok: true } | { ok: false; error: string }

async function uploadOne(photo: QueuedPhoto): Promise<UploadResult> {
  const mode = queuedPhotoMode(photo)

  if (mode === 'invalid') {
    return { ok: false, error: 'Entry malformée (ni interventionId ni siteId)' }
  }

  const fd = new FormData()
  fd.set('file', new File([photo.blob], photo.filename, { type: photo.mimeType }))

  if (mode === 'legacy') {
    fd.set('intervention_id', photo.interventionId!)
    fd.set('checklist_item_id', photo.checklistItemId ?? '')
    fd.set('kind', photo.kind)
    const r = await uploadPhotoMobileAction(fd)
    if (r && 'ok' in r && r.ok) return { ok: true }
    return { ok: false, error: (r as { error?: string }).error ?? 'unknown' }
  }

  // mode === 'spontaneous'
  if (!photo.siteId || !photo.intent || !photo.clientUuid) {
    return { ok: false, error: 'Entry spontanée incomplète (siteId/intent/clientUuid manquant)' }
  }
  fd.set('site_id', photo.siteId)
  fd.set('intent', photo.intent)
  fd.set('client_uuid', photo.clientUuid)
  const r = await uploadSpontaneousTraceAction(fd)
  if (r && 'ok' in r && r.ok) return { ok: true }
  return { ok: false, error: (r as { error?: string }).error ?? 'unknown' }
}

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

      // Upload séquentiel (1 à la fois) pour éviter la saturation bande passante.
      for (const photo of queue) {
        if (!isReadyForRetry(photo)) continue

        const attemptStartedAt = Date.now()
        try {
          const result = await uploadOne(photo)
          if (result.ok) {
            await removeQueuedPhoto(photo.tempId)
            successCount += 1
            router.refresh()
          } else {
            const nextAttempts = photo.attempts + 1
            await updateQueuedPhoto(photo.tempId, {
              attempts: nextAttempts,
              lastAttemptAt: attemptStartedAt,
              lastError: result.error,
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
    // Trigger once on mount, then every 30 seconds, then on online events.
    void sync()
    const interval = setInterval(() => { void sync() }, 30_000)
    const handleOnline = () => { void sync() }
    window.addEventListener('online', handleOnline)
    return () => {
      clearInterval(interval)
      window.removeEventListener('online', handleOnline)
    }
  }, [sync])

  return { pendingCount, syncNow: sync }
}
