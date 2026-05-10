'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { uploadPhotoMobileAction } from './actions'
import {
  listQueuedPhotos,
  removeQueuedPhoto,
  updateQueuedPhoto,
} from '@/lib/field/photo-queue'

const RETRY_BACKOFF_MS = [0, 5_000, 30_000, 300_000, 3_600_000] // 0s, 5s, 30s, 5min, 1h

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

      // Upload sequentially (1 at a time) to avoid bandwidth saturation
      for (const photo of queue) {
        const delay = RETRY_BACKOFF_MS[Math.min(photo.attempts, RETRY_BACKOFF_MS.length - 1)]
        const sinceTaken = Date.now() - photo.takenAt
        if (delay > 0 && sinceTaken < delay) continue // wait for next backoff window

        try {
          const fd = new FormData()
          fd.set('intervention_id', photo.interventionId)
          fd.set('checklist_item_id', photo.checklistItemId ?? '')
          fd.set('kind', photo.kind)
          fd.set('file', new File([photo.blob], photo.filename, { type: photo.mimeType }))

          const r = await uploadPhotoMobileAction(fd)
          if (r && 'ok' in r && r.ok) {
            await removeQueuedPhoto(photo.tempId)
            router.refresh()
          } else {
            const errMsg = (r as { error?: string }).error ?? 'unknown'
            await updateQueuedPhoto(photo.tempId, {
              attempts: photo.attempts + 1,
              lastError: errMsg,
            })
          }
        } catch (e) {
          await updateQueuedPhoto(photo.tempId, {
            attempts: photo.attempts + 1,
            lastError: e instanceof Error ? e.message : 'unknown',
          })
        }
      }
      // Refresh pending count after pass
      const remaining = await listQueuedPhotos()
      setPendingCount(remaining.length)
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
