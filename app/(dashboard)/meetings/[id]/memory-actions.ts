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
import { transcribeAudio, mimeToExt } from '@/lib/ai/transcribe'
import { setSourceTranscript, buildCombinedCorpus, listAudioSources, type AudioSourceType, AUDIO_SOURCE_TYPES } from '@/lib/db/report-audio-sources'
import { runSiteReportAnalysisAgent } from '@/services/ai/site-report-analysis'
import { listProposals, bulkInsertProposals, mergeReportAnalysis, setReportStatus } from '@/lib/db/site-reports'
import { listSiteActionsBySite } from '@/lib/db/site-actions'
import { createAnalysisRun, type AnalysisDelta } from '@/lib/db/report-analysis-runs'

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

// ───────────────────────── RÉ-ÉCOUTE + RELANCE DE TRANSCRIPTION ──────────────────
// Une erreur de transcription ne doit jamais bloquer : l'audio est conservé, on peut
// le RÉÉCOUTER (URL signée) et RELANCER la transcription autant de fois que nécessaire.

/** URL signée (1 h) de l'audio d'une source, pour le réécouter dans le navigateur. */
export async function getAudioSourceUrlAction(
  attachmentId: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  await guard()
  const sb = createAdminClient()
  const { data: att } = await sb.from('site_report_attachments').select('storage_path, kind').eq('id', attachmentId).maybeSingle()
  if (!att || att.kind !== 'audio') return { ok: false, error: 'Source audio introuvable.' }
  const { data: signed, error } = await sb.storage.from(BUCKET).createSignedUrl(att.storage_path as string, 3600)
  if (error || !signed?.signedUrl) return { ok: false, error: 'Audio indisponible.' }
  return { ok: true, url: signed.signedUrl }
}

/** Relance la transcription d'une source (échec / vide / jamais faite). Reconstruit le corpus. */
export async function retranscribeSourceAction(
  attachmentId: string,
): Promise<{ ok: true; chars: number } | { ok: false; error: string }> {
  await guard()
  const sb = createAdminClient()
  const { data: att } = await sb.from('site_report_attachments').select('id, report_id, storage_path, mime_type, kind').eq('id', attachmentId).maybeSingle()
  if (!att || att.kind !== 'audio') return { ok: false, error: 'Source audio introuvable.' }
  const reportId = att.report_id as string
  try {
    await sb.from('site_report_attachments').update({ transcript_status: 'pending' }).eq('id', attachmentId)
    const { data: blob, error: dlErr } = await sb.storage.from(BUCKET).download(att.storage_path as string)
    if (dlErr || !blob) {
      await setSourceTranscript(attachmentId, '', 'failed'); revalidatePath(`/meetings/${reportId}`)
      return { ok: false, error: 'Audio introuvable dans le stockage.' }
    }
    const mime = (att.mime_type as string | null) ?? 'audio/webm'
    const transcript = await transcribeAudio(await blob.arrayBuffer(), mime, mimeToExt(mime))
    if (!transcript.trim()) {
      await setSourceTranscript(attachmentId, '', 'failed'); revalidatePath(`/meetings/${reportId}`)
      return { ok: false, error: 'Transcription revenue vide — réessayez, ou vérifiez que l’audio est audible.' }
    }
    await setSourceTranscript(attachmentId, transcript, 'done')
    const corpus = await buildCombinedCorpus(reportId)
    await sb.from('site_reports').update({ transcript_raw: corpus, transcript_status: 'done' }).eq('id', reportId)
    revalidatePath(`/meetings/${reportId}`)
    return { ok: true, chars: transcript.length }
  } catch (e) {
    await setSourceTranscript(attachmentId, '', 'failed'); revalidatePath(`/meetings/${reportId}`)
    return { ok: false, error: e instanceof Error ? e.message : 'Transcription échouée.' }
  }
}

// ───────────────────────── RÉ-ANALYSE non destructive (mig 142, P2b) ─────────────
// Jamais auto, jamais destructive : on relance l'agent sur le CORPUS FUSIONNÉ, on
// garde tout l'existant, et on n'insère que les NOUVEAUX éléments (dédup déterministe
// type + libellé normalisé), taggés 'reanalysis'. Delta enregistré pour l'historique.
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

export async function reanalyzeReportAction(
  reportId: string,
): Promise<{ ok: true; delta: AnalysisDelta } | { ok: false; error: string }> {
  const user = await guard()
  const report = await getSiteReport(reportId)
  if (!report) return { ok: false, error: 'Réunion introuvable.' }
  if (!report.site_id) return { ok: false, error: 'Réunion sans site.' }
  try {
    // Corpus fusionné (compléments inclus) ; repli sur le transcript stocké.
    const corpus = (await buildCombinedCorpus(reportId)) || report.transcript_corrected || report.transcript_raw || ''
    const textInput = report.text_input ?? null
    if (!corpus.trim() && !(textInput ?? '').trim()) return { ok: false, error: 'Rien à ré-analyser (corpus vide).' }

    const sb = createAdminClient()
    const { data: atts } = await sb.from('site_report_attachments').select('filename, kind').eq('report_id', reportId)
    const attachmentNames = (atts ?? []).filter((a) => a.kind !== 'audio' && a.filename).map((a) => a.filename as string)
    const priorOpen = await listSiteActionsBySite(report.site_id, { status: 'open' })
    const priorOpenActions = priorOpen.map((a) => ({ id: a.id, title: a.title, corps_etat: a.corps_etat }))

    const { proposals, participants, risks } = await runSiteReportAnalysisAgent({
      transcript: corpus,
      textInput,
      attachmentNames,
      priorOpenActions,
      candidateSites: [],
      defaultSiteId: report.site_id,
      meetingDateLabel: report.created_at,
      userId: user.id,
    })

    // Dédup déterministe vs propositions EXISTANTES (tous statuts → on ne re-propose
    // pas ce qui a déjà été vu/curé). Clé = type + libellé normalisé.
    const existing = await listProposals(reportId)
    const seen = new Set(existing.map((p) => `${p.type}::${norm(p.short_label)}`))
    const fresh = proposals.filter((p) => !seen.has(`${p.type}::${norm(p.short_label)}`))

    if (fresh.length > 0) {
      await bulkInsertProposals({
        report_id: reportId,
        origin: 'reanalysis',
        proposals: fresh.map((p) => ({
          type: p.type, payload: p.payload, short_label: p.short_label, rationale: p.rationale,
          category: p.category, corps_etat: p.corps_etat, assigned_to: p.assigned_to, site_id: p.site_id, ai_confidence: p.ai_confidence,
        })),
      })
    }
    const merged = await mergeReportAnalysis(reportId, { participants, risks })

    const byType: Record<string, number> = {}
    for (const p of fresh) byType[p.type] = (byType[p.type] ?? 0) + 1
    const delta: AnalysisDelta = {
      newActions: byType['action'] ?? 0,
      newProposals: fresh.length,
      newParticipants: merged.addedParticipants,
      newRisks: merged.addedRisks,
      byType,
    }
    const sources = await listAudioSources(reportId)
    await createAnalysisRun({ reportId, trigger: 'reanalysis', sourceCount: sources.length, delta })
    if (report.status !== 'curated' && report.status !== 'archived') await setReportStatus(reportId, 'proposed')

    revalidatePath(`/meetings/${reportId}`)
    return { ok: true, delta }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Ré-analyse échouée.' }
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
