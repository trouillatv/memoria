// AUDIO MULTI-SOURCES d'une réunion (mig 141) — résilience de la capture. Réutilise
// site_report_attachments (kind='audio'). Chaque source : label, type, durée,
// transcription propre, poids. Le CORPUS = concaténation étiquetée des transcriptions.
// La COUVERTURE = « Santé de la mémoire » (qualité de capture), jamais un détecteur.
import { createAdminClient } from '@/lib/supabase/admin'
import { AUDIO_SOURCE_TYPES, AUDIO_SOURCE_LABEL, type AudioSourceType } from './audio-source-constants'
import { listGlossaryTerms, applyGlossaryCorrections } from './glossary'

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
  /** Provenance (mig 193) : 'memoria' = capté dans l'app, 'phone' = enregistreur
   *  du téléphone, 'import' = fichier ajouté. NULL sur les sources antérieures. */
  sourceOrigin: 'memoria' | 'phone' | 'import' | null
  /** Horaires réels de capture (mig 193) — rendent les chevauchements entre
   *  sources détectables. NULL quand l'origine ne les connaît pas. */
  recordedStartedAt: string | null
  recordedEndedAt: string | null
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
    sourceOrigin: ((r.source_origin as string | null) ?? null) as AudioSource['sourceOrigin'],
    recordedStartedAt: (r.recorded_started_at as string | null) ?? null,
    recordedEndedAt: (r.recorded_ended_at as string | null) ?? null,
  }
}

/** Toutes les sources audio d'une réunion (timeline), la principale d'abord. */
export async function listAudioSources(reportId: string): Promise<AudioSource[]> {
  const { data } = await createAdminClient()
    .from('site_report_attachments')
    .select('id, label, type_source, duration_seconds, transcript_status, transcript_raw, storage_path, mime_type, created_at, source_origin, recorded_started_at, recorded_ended_at')
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

function fmtDur(sec: number | null): string | null {
  if (!sec || sec <= 0) return null
  const m = Math.round(sec / 60)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}

/** CORPUS RÉUNION : concaténation ÉTIQUETÉE des transcriptions de toutes les sources.
 *  Chaque source garde la sienne (traçabilité) ; le corpus alimente l'analyse.
 *  La DURÉE est encodée dans l'étiquette → le POIDS de la source (`source_weight`)
 *  devient RÉEL pour le LLM (un débrief de 2 min ne pèse pas comme une réunion d'1h20),
 *  pas décoratif. Le 1er audio (le plus long en général) est annoncé comme PRINCIPAL. */
export async function buildCombinedCorpus(reportId: string): Promise<string> {
  const sb = createAdminClient()
  const { data } = await sb
    .from('site_report_attachments')
    .select('label, type_source, duration_seconds, transcript_raw, created_at')
    .eq('report_id', reportId)
    .eq('kind', 'audio')
    .order('created_at', { ascending: true })
  const parts: string[] = []
  ;(data ?? []).forEach((r, i) => {
    const t = ((r.transcript_raw as string | null) ?? '').trim()
    if (!t) return
    const type = (r.type_source as AudioSourceType | null) ?? (i === 0 ? 'audio_meeting' : 'other')
    const label = ((r.label as string | null) ?? '').trim() || (i === 0 ? 'Audio principal' : AUDIO_SOURCE_LABEL[type])
    const dur = fmtDur(r.duration_seconds as number | null)
    const tag = [label, i === 0 ? 'source principale' : 'complément', dur].filter(Boolean).join(' · ')
    parts.push(`[${tag}]\n${t}`)
  })
  let corpus = parts.join('\n\n')

  // Repli (ancien chemin mono-source) : aucune transcription par-pièce mais la
  // réunion a un transcript au niveau report → on l'utilise comme corpus, sinon
  // la ré-analyse repartirait à vide.
  if (!corpus.trim()) {
    const { data: rep } = await sb
      .from('site_reports')
      .select('transcript_corrected, transcript_raw')
      .eq('id', reportId)
      .maybeSingle()
    corpus = (((rep as { transcript_corrected: string | null; transcript_raw: string | null } | null)?.transcript_corrected
      ?? (rep as { transcript_raw: string | null } | null)?.transcript_raw) ?? '').trim()
  }

  // Correction par le glossaire métier (mig 150) : « finisher » → « finisseur ».
  // Déterministe, appliquée au CORPUS (les transcriptions brutes par source
  // restent intactes — l'artefact brut n'est jamais modifié). Best-effort.
  try {
    const terms = await listGlossaryTerms()
    if (terms.length > 0) return applyGlossaryCorrections(corpus, terms)
  } catch {
    /* glossaire indisponible → corpus non corrigé, jamais bloquant */
  }
  return corpus
}

export interface MemoryHealth {
  sourceCount: number
  capturedSeconds: number
  estimatedMinutes: number | null
  coveragePercent: number | null
  level: 'green' | 'amber' | 'unknown'
  transcriptComplete: boolean
  analysisGenerated: boolean
  /** Transcript au niveau réunion (ancien chemin mono-source). La pièce audio
   *  principale n'a alors pas de transcript propre, mais la mémoire EST présente. */
  reportHasTranscript: boolean
}

/** SANTÉ DE LA MÉMOIRE (≠ détecteur chantier) : couverture audio + état de capture.
 *  Indicative, JAMAIS bloquante. */
export async function computeMemoryHealth(reportId: string): Promise<MemoryHealth> {
  const sb = createAdminClient()
  const [{ data: report }, sources] = await Promise.all([
    sb.from('site_reports').select('status, estimated_duration_minutes, transcript_raw, transcript_corrected').eq('id', reportId).maybeSingle(),
    listAudioSources(reportId),
  ])
  const rep = report as { status: string; estimated_duration_minutes: number | null; transcript_raw: string | null; transcript_corrected: string | null } | null
  const capturedSeconds = sources.reduce((s, a) => s + (a.durationSeconds ?? 0), 0)
  const estimatedMinutes = rep?.estimated_duration_minutes ?? null
  const coveragePercent = estimatedMinutes && estimatedMinutes > 0
    ? Math.min(100, Math.round((capturedSeconds / (estimatedMinutes * 60)) * 100))
    : null
  const level: MemoryHealth['level'] = coveragePercent == null ? 'unknown' : coveragePercent >= 85 ? 'green' : 'amber'
  const reportHasTranscript = !!((rep?.transcript_corrected ?? '').trim() || (rep?.transcript_raw ?? '').trim())
  const audible = sources.filter((s) => s.transcriptStatus !== 'none')
  // Transcript présent si le corpus par-source est complet OU si la réunion a un
  // transcript au niveau report (ancien chemin mono-source).
  const transcriptComplete = audible.every((s) => s.transcriptStatus === 'done') && (reportHasTranscript || audible.length > 0)
  const status = rep?.status
  const analysisGenerated = status === 'proposed' || status === 'curated' || status === 'archived'
  return { sourceCount: sources.length, capturedSeconds, estimatedMinutes, coveragePercent, level, transcriptComplete, analysisGenerated, reportHasTranscript }
}
