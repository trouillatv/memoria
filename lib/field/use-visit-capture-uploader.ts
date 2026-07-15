'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  drainVisitCaptureAction,
  drainLightCaptureAction,
  createVisitVideoUploadAction,
  registerVisitVideoAction,
} from '@/app/(field)/m/site/[siteId]/capture-actions'
import { createClient } from '@/lib/supabase/client'
import {
  isReadyForRetry,
  listQueuedVisitCaptures,
  listQueuedVisitCapturesByReport,
  removeQueuedVisitCapture,
  updateQueuedVisitCapture,
  LIGHT_VISIT_KINDS,
  type QueuedVisitCapture,
  type QueuedVisitKind,
} from '@/lib/field/visit-capture-queue'
import { reportUploadStart, reportUploadEnd, reportUploadSuccess } from '@/lib/field/sync-status'

type DrainResult =
  | { ok: true; captureId: string; kind: 'video' }
  | { ok: false; error: string; drop?: boolean }

/**
 * Drain d'une VIDÉO : upload DIRECT navigateur → Supabase (URL signée), qui
 * contourne la limite du corps des fonctions Vercel (une vidéo POSTée à un
 * Server Action est rejetée en 413 dès ~4,5 Mo). Le blob est déjà en sécurité
 * dans IndexedDB : ici on ne fait que le monter, avec reprise au prochain passage
 * du drain si le réseau lâche. Idempotent par client_uuid (mig 177) : un re-drain
 * après succès partiel ne duplique jamais la capture.
 */
async function drainVideoDirect(item: QueuedVisitCapture): Promise<DrainResult> {
  const prep = await createVisitVideoUploadAction({
    report_id: item.reportId,
    client_uuid: item.clientUuid,
  })
  if (!prep.ok) return { ok: false, error: prep.error }
  // Capture déjà créée (re-drain après une réponse perdue) : rien à renvoyer.
  if (prep.alreadyDone) return { ok: true, captureId: prep.captureId ?? '', kind: 'video' }

  const mime = item.mimeType || 'video/mp4'
  const file = new File([item.blob as Blob], item.filename ?? `video-${item.clientUuid}.mp4`, { type: mime })
  const { error: upErr } = await createClient()
    .storage.from('site-reports')
    .uploadToSignedUrl(prep.storagePath, prep.token, file, { contentType: mime })
  if (upErr) return { ok: false, error: upErr.message }

  const reg = await registerVisitVideoAction({
    report_id: item.reportId,
    site_id: item.siteId,
    client_uuid: item.clientUuid,
    storage_path: prep.storagePath,
    mime,
    size_bytes: item.blob?.size,
    lat: item.lat ?? undefined,
    lng: item.lng ?? undefined,
  })
  return reg.ok ? { ok: true, captureId: reg.captureId, kind: 'video' } : { ok: false, error: reg.error }
}

// Libellés lisibles pour la file de sync vivante (« Vocal — Cuisine Petratiti »).
const KIND_LABELS: Record<QueuedVisitKind, string> = {
  photo: 'Photo', video: 'Vidéo', vocal: 'Vocal', note: 'Note', verification: 'Vérification', position: 'Position',
}

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
        if (!isReadyForRetry(item)) continue
        setUploadingUuid(item.clientUuid)
        reportUploadStart(item.tempId)
        const startedAt = Date.now()
        try {
          let r: Awaited<ReturnType<typeof drainVisitCaptureAction>> | Awaited<ReturnType<typeof drainLightCaptureAction>>
          if (LIGHT_VISIT_KINDS.has(item.kind)) {
            // Geste léger (note / vérification / position) : payload JSON, pas de fichier.
            r = await drainLightCaptureAction({
              report_id: item.reportId,
              site_id: item.siteId,
              client_uuid: item.clientUuid,
              kind: item.kind as 'note' | 'verification' | 'position',
              body: item.body,
              subject_id: item.subjectId,
              lat: item.lat ?? undefined,
              lng: item.lng ?? undefined,
            })
          } else if (item.kind === 'video') {
            // Vidéo : entry sans blob = corrompue (ne se réparera jamais) → on la lâche.
            if (!item.blob || !item.filename) { await removeQueuedVisitCapture(item.tempId); continue }
            // Upload DIRECT (URL signée) — hors Vercel. Le blob durable reste dans
            // IndexedDB tant que le serveur n'a pas confirmé : réseau coupé = retry.
            r = await drainVideoDirect(item)
          } else {
            // Photo : entry sans blob = corrompue (ne se réparera jamais) → on la lâche.
            if (!item.blob || !item.filename) { await removeQueuedVisitCapture(item.tempId); continue }
            const fd = new FormData()
            fd.set('report_id', item.reportId)
            fd.set('site_id', item.siteId)
            fd.set('kind', item.kind)
            fd.set('client_uuid', item.clientUuid)
            fd.set('file', new File([item.blob], item.filename, { type: item.mimeType }))
            if (item.lat != null) fd.set('lat', String(item.lat))
            if (item.lng != null) fd.set('lng', String(item.lng))
            if (item.viewpointOf) fd.set('viewpoint_of', item.viewpointOf)
            r = await drainVisitCaptureAction(fd)
          }
          if (r.ok) {
            await removeQueuedVisitCapture(item.tempId)
            success++
            reportUploadSuccess({ kindLabel: KIND_LABELS[item.kind] ?? 'Capture', siteName: item.siteName })
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
          reportUploadEnd(item.tempId)
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
