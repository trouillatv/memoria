// lib/visits/capture-pipeline.ts
// Le WORKER d'enrichissement des captures de visite (mig 166).
//
// La visite produit progressivement de la connaissance : chaque capture s'enrichit
// TOUTE SEULE en arrière-plan avant le débrief. Aujourd'hui une seule étape est
// câblée — la TRANSCRIPTION d'un vocal — mais la forme est un pipeline extensible
// (résumé / analyse / suggestions viendront avec le débrief IA, gated usage).
//
// DOCTRINE (cf. [[visite-trois-temps]], pattern éprouvé des AO) : ce code tourne
// DANS une requête HTTP (route /api/visit-captures/process, ou le cron de
// rattrapage) — JAMAIS dans after(), que Vercel coupe. Le client ne fait que
// DÉCLENCHER ; la vérité de l'avancement est en base (processing_stage). Étapes
// indépendantes : si une étape échoue, l'audio et le transcript déjà acquis restent.

import { createAdminClient } from '@/lib/supabase/admin'
import { mimeToExt, transcribeAudio } from '@/lib/ai/transcribe'
import {
  getCapturePipelineRow,
  getCaptureAudio,
  setCaptureTranscript,
  setCaptureStage,
  markCaptureAttempt,
  listStuckCaptureIds,
} from '@/lib/db/visit-captures'

const BUCKET = 'site-reports'
// Au-delà, on abandonne l'enrichissement (stage 'failed') : l'artefact brut reste,
// le terrain n'a jamais vu d'erreur, le débrief reste possible sans le transcript.
const MAX_ATTEMPTS = 4

/**
 * Enrichit UNE capture (une étape de pipeline). Idempotent : rappelable sans
 * dégât (une capture déjà 'ready'/'failed' est ignorée). Ne lève jamais : renvoie
 * un verdict. La transcription d'un vocal va dans `body` ; le stage avance à 'ready'.
 */
export async function runCapturePipeline(
  captureId: string,
): Promise<{ ok: boolean; stage: string }> {
  const row = await getCapturePipelineRow(captureId)
  if (!row) return { ok: false, stage: 'missing' }
  if (row.processing_stage === 'ready' || row.processing_stage === 'failed') {
    return { ok: true, stage: row.processing_stage }
  }

  await markCaptureAttempt(captureId, row.processing_attempts)

  try {
    // Seule étape câblée : transcrire un vocal pas encore transcrit.
    if (row.kind === 'vocal' && row.transcript_status !== 'done') {
      const audio = await getCaptureAudio(captureId)
      if (audio) {
        const supabase = createAdminClient()
        const { data: blob, error } = await supabase.storage.from(BUCKET).download(audio.storagePath)
        if (error || !blob) throw error ?? new Error('Audio introuvable')
        const buf = (await blob.arrayBuffer()) as ArrayBuffer
        const text = (await transcribeAudio(buf, audio.mimeType, mimeToExt(audio.mimeType))).trim()
        await setCaptureTranscript(captureId, { text, status: text ? 'done' : 'failed' })
      }
    }
    // Rien de plus à pré-calculer aujourd'hui → prête pour le débrief.
    await setCaptureStage(captureId, 'ready')
    return { ok: true, stage: 'ready' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const attempts = row.processing_attempts + 1
    const giveUp = attempts >= MAX_ATTEMPTS
    console.error(JSON.stringify({
      service: 'capture-pipeline',
      capture_id: captureId,
      attempts,
      give_up: giveUp,
      error: msg,
      ts: new Date().toISOString(),
    }))
    if (giveUp) {
      if (row.kind === 'vocal') {
        await setCaptureTranscript(captureId, { text: '', status: 'failed' }).catch(() => {})
      }
      await setCaptureStage(captureId, 'failed', msg).catch(() => {})
      return { ok: false, stage: 'failed' }
    }
    // On laisse l'étape non terminale : le cron de rattrapage réessaiera.
    await setCaptureStage(captureId, row.processing_stage, msg).catch(() => {})
    return { ok: false, stage: row.processing_stage }
  }
}

/**
 * Filet de sécurité : reprend les captures coincées (stage non terminal, dernière
 * tentative au-delà du seuil). Appelé par le cron quotidien — indépendant de tout
 * déclenchement client.
 */
export async function sweepStuckCaptures(
  thresholdMs: number,
  limit = 50,
): Promise<{ swept: number; ready: number; failed: number; ids: string[] }> {
  const ids = await listStuckCaptureIds(thresholdMs, limit)
  let ready = 0
  let failed = 0
  for (const id of ids) {
    const r = await runCapturePipeline(id)
    if (r.stage === 'ready') ready += 1
    else if (r.stage === 'failed') failed += 1
  }
  return { swept: ids.length, ready, failed, ids }
}
