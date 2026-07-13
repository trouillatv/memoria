import 'server-only'

// « Si un audio arrive par le partage, on le transcrit TOUT DE SUITE. »
//
// Avant : un vocal partagé restait `transcript_status='pending'` jusqu'au
// passage du cron — c'est-à-dire jusqu'au lendemain. Guillaume partageait un
// mémo depuis WhatsApp, ouvrait MemorIA, et n'y trouvait qu'un fichier muet.
// Un audio non transcrit n'est pas de la mémoire : c'est une pièce jointe.
//
// AUCUN nouveau moteur. On déclenche les deux chaînes qui existent :
//   • visite  → `runCapturePipeline` (le worker des captures, mig 166) ;
//   • réunion → `transcribeAudio` + `setSourceTranscript` + corpus fusionné
//               (la même chaîne que le bouton « Retranscrire » d'une source).
//
// DOCTRINE (pattern éprouvé) : ce travail tourne DANS la requête HTTP, jamais
// dans `after()` — Vercel le couperait. Ce qui échoue reste en attente : le cron
// quotidien rattrape les captures, et une source de réunion garde son bouton
// « Retranscrire ». Un échec de transcription ne perd JAMAIS l'audio.

import { createAdminClient } from '@/lib/supabase/admin'
import { mimeToExt, transcribeAudio } from '@/lib/ai/transcribe'
import { runCapturePipeline } from '@/lib/visits/capture-pipeline'
import { setSourceTranscript, buildCombinedCorpus } from '@/lib/db/report-audio-sources'

const BUCKET = 'site-reports'

/** Au-delà, on laisse le reste au cron : on ne fait pas attendre l'utilisateur
 *  deux minutes devant un écran bloqué. Ce qui reste n'est pas perdu. */
const MAX_INLINE = 5

export interface TranscriptionOutcome {
  /** Combien d'enregistrements ont VRAIMENT un texte à la fin. */
  transcribed: number
  /** Combien restent en attente (échec, ou au-delà du plafond). */
  pending: number
}

/**
 * Transcrit les vocaux d'une VISITE qui viennent d'arriver.
 *
 * Le worker des captures est idempotent : le rappeler sur une capture déjà
 * traitée ne fait rien. On peut donc le lancer sans se demander ce qui a déjà
 * été fait.
 */
export async function transcribeVisitAudios(reportId: string): Promise<TranscriptionOutcome> {
  const db = createAdminClient()

  const { data } = await db
    .from('visit_capture')
    .select('id')
    .eq('report_id', reportId)
    .eq('kind', 'vocal')
    .neq('transcript_status', 'done')
    .neq('status', 'discarded')
    .order('created_at', { ascending: true })
    .limit(MAX_INLINE + 5)

  const ids = ((data ?? []) as Array<{ id: string }>).map((r) => r.id)
  if (ids.length === 0) return { transcribed: 0, pending: 0 }

  let transcribed = 0
  for (const id of ids.slice(0, MAX_INLINE)) {
    const r = await runCapturePipeline(id).catch(() => ({ ok: false, stage: 'failed' }))
    if (r.ok) transcribed += 1
  }

  return { transcribed, pending: ids.length - transcribed }
}

/**
 * Transcrit les sources audio d'une RÉUNION qui viennent d'arriver, puis
 * reconstruit le corpus fusionné.
 *
 * Le corpus est ce que l'analyse lit : sans lui, une source transcrite reste
 * invisible au compte-rendu. On le refait donc à chaque fois — c'est le même
 * geste que la chaîne existante.
 */
export async function transcribeMeetingAudios(reportId: string): Promise<TranscriptionOutcome> {
  const db = createAdminClient()

  const { data } = await db
    .from('site_report_attachments')
    .select('id, storage_path, mime_type')
    .eq('report_id', reportId)
    .eq('kind', 'audio')
    .neq('transcript_status', 'done')
    .order('created_at', { ascending: true })
    .limit(MAX_INLINE + 5)

  const rows = (data ?? []) as Array<{ id: string; storage_path: string; mime_type: string | null }>
  if (rows.length === 0) return { transcribed: 0, pending: 0 }

  let transcribed = 0
  for (const att of rows.slice(0, MAX_INLINE)) {
    try {
      const { data: blob, error } = await db.storage.from(BUCKET).download(att.storage_path)
      if (error || !blob) throw error ?? new Error('Audio introuvable')

      const mime = att.mime_type ?? 'audio/ogg'
      const text = (await transcribeAudio(await blob.arrayBuffer(), mime, mimeToExt(mime))).trim()

      // Une transcription vide n'est pas un succès : on le dit, et la source
      // garde son bouton « Retranscrire ». L'audio, lui, reste intact.
      await setSourceTranscript(att.id, text, text ? 'done' : 'failed')
      if (text) transcribed += 1
    } catch (e) {
      console.error('[partage] transcription réunion', att.id, e instanceof Error ? e.message : e)
      await setSourceTranscript(att.id, '', 'failed').catch(() => {})
    }
  }

  if (transcribed > 0) {
    // Le corpus fusionné : c'est LUI que l'analyse lit. Une source transcrite
    // mais absente du corpus resterait invisible au compte-rendu.
    const corpus = await buildCombinedCorpus(reportId).catch(() => '')
    await db
      .from('site_reports')
      .update({ transcript_raw: corpus || null, transcript_status: corpus ? 'done' : 'pending' })
      .eq('id', reportId)
  }

  return { transcribed, pending: rows.length - transcribed }
}
