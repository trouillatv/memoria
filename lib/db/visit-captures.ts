// lib/db/visit-captures.ts
// Captures de visite (mig 165) — l'ATOME brut du panier terrain.
//
// Une capture = une matière première (photo/vocal/note/vérification/position)
// déposée PENDANT la visite, AVANT toute décision métier. Cycle = les 3 temps :
//   captured (terrain) → kept|discarded (voiture) → processed (bureau).
// Invisible au métier (le mot « observation » n'apparaît jamais dans l'UX).
//
// Cf. [[visite-trois-temps]]. Réutilise la visite-objet (site_report origin,
// mig 162). Le routage multi-destination (visit_capture_routes) est posé au
// bureau, lors du Débrief complet — pas ici.

import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgId } from '@/lib/db/users'

export type VisitCaptureKind = 'photo' | 'vocal' | 'note' | 'verification' | 'position'
export type VisitCaptureStatus = 'captured' | 'kept' | 'discarded' | 'processed'
export type CaptureTranscriptStatus = 'pending' | 'done' | 'failed'
// Roll-up technique d'orchestration de l'enrichissement (mig 167). PAS un pipeline
// linéaire : chaque COUCHE a son propre *_status indépendant (transcript_status…).
// Ceci ne dit que « reste-t-il du travail de fond ? » — jamais montré au métier.
export type CaptureProcessingStage = 'pending' | 'ready' | 'failed'
const TERMINAL_STAGES: CaptureProcessingStage[] = ['ready', 'failed']

// Suite décidée au débrief express (mig 168) : action | follow | null(=trace).
export type CaptureTriageIntent = 'action' | 'follow' | null

export interface VisitCaptureRow {
  id: string
  report_id: string
  site_id: string
  kind: VisitCaptureKind
  status: VisitCaptureStatus
  body: string | null
  transcript_status: CaptureTranscriptStatus | null
  attachment_id: string | null
  subject_id: string | null
  triage_intent: CaptureTriageIntent
  lat: number | null
  lng: number | null
  created_at: string
}

export interface AddVisitCaptureInput {
  reportId: string
  siteId: string
  kind: VisitCaptureKind
  body?: string | null
  /** Pour 'vocal' : 'pending' au dépôt — la transcription démarre en tâche de fond dès l'upload. */
  transcriptStatus?: CaptureTranscriptStatus | null
  /** Pour 'photo'/'vocal' : la pièce dans site_report_attachments. */
  attachmentId?: string | null
  /** Pour 'verification' : le point suivi recontrôlé. */
  subjectId?: string | null
  lat?: number | null
  lng?: number | null
  createdBy: string | null
}

/** Dépose une capture brute dans le panier de la visite (statut 'captured'). */
export async function addVisitCapture(input: AddVisitCaptureInput): Promise<string> {
  const supabase = createAdminClient()
  const orgId = await getOrgId()

  const { data, error } = await supabase
    .from('visit_capture')
    .insert({
      organization_id: orgId,
      report_id: input.reportId,
      site_id: input.siteId,
      kind: input.kind,
      status: 'captured',
      // Seul le vocal a une couche à poser aujourd'hui (transcription) → 'pending' ;
      // les autres gestes n'ont rien à pré-calculer → 'ready' direct.
      processing_stage: input.kind === 'vocal' ? 'pending' : 'ready',
      body: input.body ?? null,
      transcript_status: input.transcriptStatus ?? null,
      attachment_id: input.attachmentId ?? null,
      subject_id: input.subjectId ?? null,
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      created_by: input.createdBy,
    })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

/** Les captures d'une visite, dans l'ordre du terrain (timeline du panier). */
export async function listVisitCaptures(reportId: string): Promise<VisitCaptureRow[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('visit_capture')
    .select('id, report_id, site_id, kind, status, body, transcript_status, attachment_id, subject_id, triage_intent, lat, lng, created_at')
    .eq('report_id', reportId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as VisitCaptureRow[]
}

/** Les captures de visite rattachées à un point suivi — pour le dossier vivant. */
export async function listVisitCapturesBySubject(subjectId: string): Promise<VisitCaptureRow[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('visit_capture')
    .select('id, report_id, site_id, kind, status, body, transcript_status, attachment_id, subject_id, triage_intent, lat, lng, created_at')
    .eq('subject_id', subjectId)
    .neq('status', 'discarded')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as VisitCaptureRow[]
}

/** Combien de captures non écartées dans le panier (badge « N éléments »). */
export async function countVisitCaptures(reportId: string): Promise<number> {
  const supabase = createAdminClient()
  const { count, error } = await supabase
    .from('visit_capture')
    .select('id', { count: 'exact', head: true })
    .eq('report_id', reportId)
    .neq('status', 'discarded')
  if (error) throw error
  return count ?? 0
}

/**
 * Charge la pièce audio d'un vocal pour la transcription de fond. Renvoie null
 * s'il n'y a rien à faire (pas un vocal, sans pièce, ou déjà transcrit).
 * Étapes indépendantes : même si l'analyse IA échoue plus tard, l'audio et le
 * transcript restent acquis.
 */
export async function getCaptureAudio(
  captureId: string,
): Promise<{ storagePath: string; mimeType: string } | null> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('visit_capture')
    .select('attachment_id, kind, transcript_status')
    .eq('id', captureId)
    .maybeSingle()
  const cap = data as { attachment_id: string | null; kind: string; transcript_status: string | null } | null
  if (!cap || cap.kind !== 'vocal' || !cap.attachment_id || cap.transcript_status === 'done') return null
  const { data: att } = await supabase
    .from('site_report_attachments')
    .select('storage_path, mime_type')
    .eq('id', cap.attachment_id)
    .maybeSingle()
  const a = att as { storage_path: string; mime_type: string | null } | null
  if (!a?.storage_path) return null
  return { storagePath: a.storage_path, mimeType: a.mime_type ?? 'audio/webm' }
}

/** Ligne minimale dont le worker a besoin pour enrichir une capture. */
export interface CapturePipelineRow {
  id: string
  kind: VisitCaptureKind
  transcript_status: CaptureTranscriptStatus | null
  processing_stage: CaptureProcessingStage
  processing_attempts: number
}

/** Charge l'état pipeline d'une capture (pour le worker). */
export async function getCapturePipelineRow(captureId: string): Promise<CapturePipelineRow | null> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('visit_capture')
    .select('id, kind, transcript_status, processing_stage, processing_attempts')
    .eq('id', captureId)
    .maybeSingle()
  return (data as CapturePipelineRow | null) ?? null
}

/** Marque une tentative d'enrichissement (horodatage + compteur) avant de travailler. */
export async function markCaptureAttempt(captureId: string, attempts: number): Promise<void> {
  const supabase = createAdminClient()
  await supabase
    .from('visit_capture')
    .update({ processing_at: new Date().toISOString(), processing_attempts: attempts + 1 })
    .eq('id', captureId)
}

/** Avance (ou échoue) l'étape pipeline d'une capture. */
export async function setCaptureStage(
  captureId: string,
  stage: CaptureProcessingStage,
  error?: string | null,
): Promise<void> {
  const supabase = createAdminClient()
  const { error: dbErr } = await supabase
    .from('visit_capture')
    .update({ processing_stage: stage, processing_error: error ?? null })
    .eq('id', captureId)
  if (dbErr) throw dbErr
}

/**
 * Les captures « coincées » que le cron de rattrapage doit reprendre : étape non
 * terminale, et jamais tentée OU dont la dernière tentative date d'avant le seuil
 * (on ne reprend pas une capture encore légitimement en cours dans une requête).
 */
export async function listStuckCaptureIds(thresholdMs: number, limit = 50): Promise<string[]> {
  const supabase = createAdminClient()
  const cutoff = new Date(Date.now() - thresholdMs).toISOString()
  const { data } = await supabase
    .from('visit_capture')
    .select('id')
    .not('processing_stage', 'in', `(${TERMINAL_STAGES.join(',')})`)
    .or(`processing_at.is.null,processing_at.lt.${cutoff}`)
    .order('processing_at', { ascending: true, nullsFirst: true })
    .limit(limit)
  return ((data ?? []) as Array<{ id: string }>).map((r) => r.id)
}

/** Inscrit le résultat de la transcription d'un vocal (le texte va dans body). */
export async function setCaptureTranscript(
  captureId: string,
  result: { text: string; status: 'done' | 'failed' },
): Promise<void> {
  const supabase = createAdminClient()
  const patch: Record<string, unknown> = { transcript_status: result.status }
  if (result.status === 'done') patch.body = result.text
  const { error } = await supabase.from('visit_capture').update(patch).eq('id', captureId)
  if (error) throw error
}

/**
 * Décision du débrief express (mig 168) : garder/ignorer (status) + suite
 * éventuelle (intent). Réversible : on peut re-trier autant qu'on veut. La
 * matérialisation des suites se fait au bureau, pas ici.
 */
export async function setCaptureTriage(
  captureId: string,
  decision: { status: 'kept' | 'discarded'; intent: CaptureTriageIntent },
): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('visit_capture')
    .update({
      status: decision.status,
      triage_intent: decision.intent,
      updated_at: new Date().toISOString(),
    })
    .eq('id', captureId)
  if (error) throw error
}

/**
 * Retire une capture du panier PENDANT la collecte (faux geste). Suppression dure
 * autorisée UNIQUEMENT tant qu'elle est encore brute (status='captured') : rien
 * n'en dépend. Après le tri, on n'efface plus — on « écarte » (discarded), réversible.
 */
export async function removeCaptureWhileCollecting(captureId: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('visit_capture')
    .delete()
    .eq('id', captureId)
    .eq('status', 'captured')
  if (error) throw error
}
