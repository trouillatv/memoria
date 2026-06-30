'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { drainVisitCaptureAction } from '@/app/(field)/m/site/[siteId]/capture-actions'
import {
  isReadyForRetry,
  listQueuedVisitCaptures,
  listQueuedVisitCapturesByReport,
  removeQueuedVisitCapture,
  updateQueuedVisitCapture,
  type QueuedVisitCapture,
} from '@/lib/field/visit-capture-queue'

/**
 * Drain de la file IndexedDB des captures de visite (Lot B). Deux usages :
 *   - SANS reportId (drainer global, monté dans le layout) : monte tout ce qui
 *     traîne, même après qu'on a quitté le panier, et rafraîchit la vue.
 *   - AVEC reportId + onUploaded (le panier) : pilote l'UI optimiste de la
 *     visite courante — on retire la vignette « en attente » dès que le serveur
 *     a confirmé la capture.
 *
 * Backoff exponentiel et online-listener réutilisent les primitives de la file
 * legacy. Idempotence par client_uuid (mig 177) : deux drainers concurrents
 * (global + panier) sont inoffensifs — au pire un double-pass sans effet.
 */
export function useVisitCaptureUploader(opts?: {
  reportId?: string
  /** Si fourni, on ne draine QUE les dépôts de ce compte (appareil partagé). */
  userId?: string
  onUploaded?: (clientUuid: string, captureId: string) => void
}): { queued: QueuedVisitCapture[]; uploadingUuid: string | null; syncNow: () => Promise<void> } {
  const router = useRouter()
  const reportId = opts?.reportId
  const userId = opts?.userId
  const onUploaded = opts?.onUploaded
  const [queued, setQueued] = useState<QueuedVisitCapture[]>([])
  const [uploadingUuid, setUploadingUuid] = useState<string | null>(null)
  const isUploadingRef = useRef(false)

  const readList = useCallback(async () => {
    const all = reportId
      ? await listQueuedVisitCapturesByReport(reportId)
      : await listQueuedVisitCaptures()
    // Anti cross-compte : on ignore les dépôts d'un autre agent (les siens
    // attendront son retour). Les entries non taguées (rétrocompat) passent.
    return userId ? all.filter((e) => !e.userId || e.userId === userId) : all
  }, [reportId, userId])

  const sync = useCallback(async () => {
    if (isUploadingRef.current) return
    isUploadingRef.current = true
    try {
      const all = await readList()
      setQueued(all)
      if (all.length === 0) return

      let success = 0
      // Envoi séquentiel (1 à la fois) — on ne sature pas un réseau terrain faible.
      for (const item of all) {
        // La vidéo ne passe PLUS par la file (upload direct, trop lourde pour
        // IndexedDB + Server Action). On purge les entrées vidéo legacy coincées.
        if (item.kind === 'video') { await removeQueuedVisitCapture(item.tempId); continue }
        if (!isReadyForRetry(item)) continue
        setUploadingUuid(item.clientUuid)
        const startedAt = Date.now()
        try {
          const fd = new FormData()
          fd.set('report_id', item.reportId)
          fd.set('site_id', item.siteId)
          fd.set('kind', item.kind)
          fd.set('client_uuid', item.clientUuid)
          fd.set('file', new File([item.blob], item.filename, { type: item.mimeType }))
          if (item.lat != null) fd.set('lat', String(item.lat))
          if (item.lng != null) fd.set('lng', String(item.lng))
          const r = await drainVisitCaptureAction(fd)
          if (r.ok) {
            await removeQueuedVisitCapture(item.tempId)
            success++
            // Vocal : on déclenche la transcription de fond (cf. kickCaptureProcessing).
            if (r.kind === 'vocal') {
              fetch('/api/visit-captures/process', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ captureId: r.captureId }),
                keepalive: true,
              }).catch(() => { /* le cron rattrapera */ })
            }
            onUploaded?.(item.clientUuid, r.captureId)
          } else if (r.drop) {
            // Irrécupérable (visite supprimée, params invalides) : on retire de la
            // file plutôt que de re-tenter indéfiniment une entry condamnée.
            await removeQueuedVisitCapture(item.tempId)
          } else {
            await updateQueuedVisitCapture(item.tempId, {
              attempts: item.attempts + 1,
              lastAttemptAt: startedAt,
              lastError: r.error,
            })
          }
        } catch (e) {
          await updateQueuedVisitCapture(item.tempId, {
            attempts: item.attempts + 1,
            lastAttemptAt: startedAt,
            lastError: e instanceof Error ? e.message : 'unknown',
          })
        } finally {
          setUploadingUuid(null)
        }
      }

      setQueued(await readList())
      // Drainer global : rafraîchit la vue pour refléter les captures montées.
      // Panier : c'est onUploaded qui rafraîchit (refresh ciblé des captures).
      if (success > 0 && !onUploaded) router.refresh()
    } finally {
      isUploadingRef.current = false
    }
  }, [readList, onUploaded, router])

  useEffect(() => {
    void sync()
    const interval = setInterval(() => { void sync() }, 8_000)
    const onOnline = () => { void sync() }
    window.addEventListener('online', onOnline)
    return () => {
      clearInterval(interval)
      window.removeEventListener('online', onOnline)
    }
  }, [sync])

  return { queued, uploadingUuid, syncNow: sync }
}
