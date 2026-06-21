'use server'

// AUDIO DE SECOURS / MULTI-SOURCES (mig 141, P2a) — actions serveur. Ajouter une
// source audio (mémo, appel, débrief) à une réunion : upload → transcription DE LA
// SOURCE → reconstruction du CORPUS fusionné. + durée estimée (couverture mémoire).
// Best-effort sur la transcription : l'upload réussit même si la transcription échoue
// (on ne perd jamais l'audio — c'est tout le but de la résilience).
import { revalidatePath } from 'next/cache'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteReport } from '@/lib/db/site-reports'
import { createAdminClient } from '@/lib/supabase/admin'
import { transcribeAudio } from '@/lib/ai/transcribe'
import { setSourceTranscript, buildCombinedCorpus, type AudioSourceType, AUDIO_SOURCE_TYPES } from '@/lib/db/report-audio-sources'

const BUCKET = 'site-reports'
const MAX_AUDIO_BYTES = 25 * 1024 * 1024
const AUDIO_RE = /^audio\/(mp3|mpeg|mp4|m4a|x-m4a|aac|ogg|webm|wav|x-wav)$/i

async function guard() {
  const user = await getCurrentUserWithProfile()
  if (!user || (user.role !== 'admin' && user.role !== 'manager')) throw new Error('Accès refusé.')
  return user
}

export async function addMeetingAudioSourceAction(
  formData: FormData,
): Promise<{ ok: true; transcribed: boolean } | { ok: false; error: string }> {
  const user = await guard()
  const reportId = String(formData.get('report_id') ?? '')
  const file = formData.get('file')
  const label = String(formData.get('label') ?? '').trim()
  const typeRaw = String(formData.get('type_source') ?? 'other')
  const typeSource: AudioSourceType = (AUDIO_SOURCE_TYPES as string[]).includes(typeRaw) ? (typeRaw as AudioSourceType) : 'other'
  const durRaw = Number(formData.get('duration_seconds'))
  const durationSeconds = Number.isFinite(durRaw) && durRaw > 0 ? Math.round(durRaw) : null
  if (!reportId) return { ok: false, error: 'Réunion inconnue.' }
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'Aucun fichier.' }
  if (file.size > MAX_AUDIO_BYTES) return { ok: false, error: 'Fichier trop lourd (max 25 Mo).' }
  if (!AUDIO_RE.test(file.type)) return { ok: false, error: 'Format audio non supporté.' }

  const report = await getSiteReport(reportId)
  if (!report) return { ok: false, error: 'Réunion introuvable.' }
  try {
    const sb = createAdminClient()
    const orgId = report.site_id
      ? ((await sb.from('sites').select('organization_id').eq('id', report.site_id).maybeSingle()).data as { organization_id: string | null } | null)?.organization_id ?? 'org'
      : 'org'
    const ext = (file.name.split('.').pop() ?? 'm4a').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'm4a'
    const storagePath = `${orgId}/${reportId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const arrayBuf = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuf)
    const { error: upErr } = await sb.storage.from(BUCKET).upload(storagePath, buffer, { contentType: file.type, upsert: false })
    if (upErr) return { ok: false, error: `Upload échoué : ${upErr.message}` }

    // Ligne attachment = la SOURCE (audio jamais perdu, même si la transcription échoue).
    const { data: att, error: insErr } = await sb
      .from('site_report_attachments')
      .insert({
        report_id: reportId, kind: 'audio', storage_path: storagePath, filename: file.name,
        mime_type: file.type, size_bytes: file.size, label: label || null,
        type_source: typeSource, duration_seconds: durationSeconds, transcript_status: 'pending',
      })
      .select('id')
      .single()
    if (insErr) return { ok: false, error: insErr.message }

    // Transcription de CETTE source (best-effort) puis reconstruction du corpus fusionné.
    let transcribed = false
    try {
      const transcript = await transcribeAudio(arrayBuf, file.type, ext)
      await setSourceTranscript(att.id as string, transcript, 'done')
      transcribed = true
      const corpus = await buildCombinedCorpus(reportId)
      await sb.from('site_reports').update({ transcript_raw: corpus, transcript_status: 'done' }).eq('id', reportId)
    } catch {
      await setSourceTranscript(att.id as string, '', 'failed') // audio conservé, transcription à relancer
    }
    void user
    revalidatePath(`/meetings/${reportId}`)
    return { ok: true, transcribed }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Échec' }
  }
}

export async function setEstimatedDurationAction(
  reportId: string,
  minutes: number | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await guard()
  const v = minutes && minutes > 0 ? Math.round(minutes) : null
  try {
    const { error } = await createAdminClient().from('site_reports').update({ estimated_duration_minutes: v }).eq('id', reportId)
    if (error) throw new Error(error.message)
    revalidatePath(`/meetings/${reportId}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Échec' }
  }
}
