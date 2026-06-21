// AUDIO MULTI-SOURCES d'une réunion (mig 141) — résilience de la capture. Réutilise
// site_report_attachments (kind='audio'). Chaque source : label, type, durée,
// transcription propre, poids. Le CORPUS = concaténation étiquetée des transcriptions.
// La COUVERTURE = « Santé de la mémoire » (qualité de capture), jamais un détecteur.
import { createAdminClient } from '@/lib/supabase/admin'
import { AUDIO_SOURCE_TYPES, AUDIO_SOURCE_LABEL, type AudioSourceType } from './audio-source-constants'

export { AUDIO_SOURCE_TYPES, AUDIO_SOURCE_LABEL, type AudioSourceType }

export interface AudioSource {
  id: string
  label: string
  typeSource: AudioSourceType
  durationSeconds: number | null
  transcriptStatus: 'none' | 'pending' | 'done' | 'failed'
  hasTranscript: boolean
  storagePath: string
  mimeType: string | null
  createdAt: string
}

function rowToSource(r: Record<string, unknown>, index: number): AudioSource {
  const type = (AUDIO_SOURCE_TYPES as string[]).includes(r.type_source as string)
    ? (r.type_source as AudioSourceType)
    : index === 0 ? 'audio_meeting' : 'other'
  const label = ((r.label as string | null) ?? '').trim() || (index === 0 ? 'Audio principal' : AUDIO_SOURCE_LABEL[type])
  return {
    id: r.id as string,
    label,
    typeSource: type,
    durationSeconds: (r.duration_seconds as number | null) ?? null,
    transcriptStatus: ((r.transcript_status as string | null) ?? 'none') as AudioSource['transcriptStatus'],
    hasTranscript: !!(r.transcript_raw as string | null),
    storagePath: r.storage_path as string,
    mimeType: (r.mime_type as string | null) ?? null,
    createdAt: r.created_at as string,
  }
}

/** Toutes les sources audio d'une réunion (timeline), la principale d'abord. */
export async function listAudioSources(reportId: string): Promise<AudioSource[]> {
  const { data } = await createAdminClient()
    .from('site_report_attachments')
    .select('id, label, type_source, duration_seconds, transcript_status, transcript_raw, storage_path, mime_type, created_at')
    .eq('report_id', reportId)
    .eq('kind', 'audio')
    .order('created_at', { ascending: true })
  return (data ?? []).map((r, i) => rowToSource(r, i))
}

export async function setSourceTranscript(attachmentId: string, raw: string, status: 'done' | 'failed'): Promise<void> {
  const { error } = await createAdminClient()
    .from('site_report_attachments')
    .update({ transcript_raw: raw || null, transcript_status: status, transcribed_at: new Date().toISOString() })
    .eq('id', attachmentId)
  if (error) throw new Error(error.message)
}

/** CORPUS RÉUNION : concaténation ÉTIQUETÉE des transcriptions de toutes les sources.
 *  Chaque source garde la sienne (traçabilité) ; le corpus alimente l'analyse. */
export async function buildCombinedCorpus(reportId: string): Promise<string> {
  const sb = createAdminClient()
  const { data } = await sb
    .from('site_report_attachments')
    .select('label, type_source, transcript_raw, created_at')
    .eq('report_id', reportId)
    .eq('kind', 'audio')
    .order('created_at', { ascending: true })
  const parts: string[] = []
  ;(data ?? []).forEach((r, i) => {
    const t = ((r.transcript_raw as string | null) ?? '').trim()
    if (!t) return
    const type = (r.type_source as AudioSourceType | null) ?? (i === 0 ? 'audio_meeting' : 'other')
    const label = ((r.label as string | null) ?? '').trim() || (i === 0 ? 'Audio principal' : AUDIO_SOURCE_LABEL[type])
    parts.push(`[${label}]\n${t}`)
  })
  return parts.join('\n\n')
}

export interface MemoryHealth {
  sourceCount: number
  capturedSeconds: number
  estimatedMinutes: number | null
  coveragePercent: number | null
  level: 'green' | 'amber' | 'unknown'
  transcriptComplete: boolean
  analysisGenerated: boolean
}

/** SANTÉ DE LA MÉMOIRE (≠ détecteur chantier) : couverture audio + état de capture.
 *  Indicative, JAMAIS bloquante. */
export async function computeMemoryHealth(reportId: string): Promise<MemoryHealth> {
  const sb = createAdminClient()
  const [{ data: report }, sources] = await Promise.all([
    sb.from('site_reports').select('status, estimated_duration_minutes').eq('id', reportId).maybeSingle(),
    listAudioSources(reportId),
  ])
  const capturedSeconds = sources.reduce((s, a) => s + (a.durationSeconds ?? 0), 0)
  const estimatedMinutes = (report as { estimated_duration_minutes: number | null } | null)?.estimated_duration_minutes ?? null
  const coveragePercent = estimatedMinutes && estimatedMinutes > 0
    ? Math.min(100, Math.round((capturedSeconds / (estimatedMinutes * 60)) * 100))
    : null
  const level: MemoryHealth['level'] = coveragePercent == null ? 'unknown' : coveragePercent >= 85 ? 'green' : 'amber'
  const audible = sources.filter((s) => s.transcriptStatus !== 'none')
  const transcriptComplete = audible.length > 0 && audible.every((s) => s.transcriptStatus === 'done')
  const status = (report as { status: string } | null)?.status
  const analysisGenerated = status === 'proposed' || status === 'curated' || status === 'archived'
  return { sourceCount: sources.length, capturedSeconds, estimatedMinutes, coveragePercent, level, transcriptComplete, analysisGenerated }
}
