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

export type VisitCaptureKind = 'photo' | 'vocal' | 'note' | 'verification' | 'position' | 'video'
export type VisitCaptureStatus = 'captured' | 'kept' | 'discarded' | 'processed'
export type CaptureTranscriptStatus = 'pending' | 'done' | 'failed'
// Roll-up technique d'orchestration de l'enrichissement (mig 167). PAS un pipeline
// linéaire : chaque COUCHE a son propre *_status indépendant (transcript_status…).
// Ceci ne dit que « reste-t-il du travail de fond ? » — jamais montré au métier.
export type CaptureProcessingStage = 'pending' | 'ready' | 'failed'
const TERMINAL_STAGES: CaptureProcessingStage[] = ['ready', 'failed']

// Suite décidée au débrief express (mig 168) : action | follow | null(=trace).
export type CaptureTriageIntent = 'action' | 'follow' | 'reserve' | null

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
  /** Cycle de la proposition de suite au débrief (mig 183) : null=à proposer,
   *  'done'=matérialisée/rattachée, 'ignored'=écartée. */
  suite_status: 'done' | 'ignored' | null
  /** Marqué « à réutiliser dans le mémoire technique » (mig 174) — optionnel, terrain. */
  starred: boolean
  /** Identité idempotente d'un dépôt offline-first (mig 177) — null pour les gestes serveur. */
  client_uuid: string | null
  lat: number | null
  lng: number | null
  /** Instant RÉEL de la capture (mig 184) — EXIF/horodatage export. NULL en direct
   *  (created_at fait foi). La timeline s'ordonne sur coalesce(captured_at, created_at). */
  captured_at: string | null
  /** Point de repère photographique (mig 195) : ancre d'une série « même cadrage ». */
  is_viewpoint: boolean
  /** Reprise d'un point de repère (mig 195) : pointe la capture ancre. */
  viewpoint_of: string | null
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
  /** Identité idempotente d'un dépôt offline-first (mig 177). Si une capture
   *  existe déjà pour ce client_uuid, on la retourne au lieu d'en créer une 2ᵉ. */
  clientUuid?: string | null
  lat?: number | null
  lng?: number | null
  /** Instant réel (mig 184) — posé à l'IMPORT pour reconstruire la chronologie.
   *  Laissé null en direct : created_at fait foi. */
  capturedAt?: string | null
  /** Reprise d'un point de repère (mig 195) — pointe la capture ancre. */
  viewpointOf?: string | null
  /** Photo clé dès la création (mig 174) — une photo ANNOTÉE l'est d'office :
   *  si on a pris le temps de dessiner dessus, c'est la meilleure pour le CR. */
  starred?: boolean
  /** Version ANNOTÉE d'une photo (mig 185) — pointe la photo d'origine. */
  annotatedOriginalId?: string | null
  createdBy: string | null
}

/** Dépose une capture brute dans le panier de la visite (statut 'captured').
 *  Idempotent si `clientUuid` est fourni : un re-drain (réseau rejoué) renvoie
 *  la capture déjà créée plutôt que d'en dupliquer une. */
export async function addVisitCapture(input: AddVisitCaptureInput): Promise<string> {
  const supabase = createAdminClient()

  // Court-circuit idempotent : si ce dépôt a déjà abouti, on renvoie l'existant.
  if (input.clientUuid) {
    const { data: existing } = await supabase
      .from('visit_capture')
      .select('id')
      .eq('client_uuid', input.clientUuid)
      .maybeSingle()
    if (existing) return (existing as { id: string }).id
  }

  const orgId = await getOrgId()
  // Hérite le dossier d'opération de la visite (un seul point de vérité : le report).
  const { data: rep } = await supabase
    .from('site_reports')
    .select('dossier_id')
    .eq('id', input.reportId)
    .maybeSingle()
  const dossierId = (rep as { dossier_id: string | null } | null)?.dossier_id ?? null

  const { data, error } = await supabase
    .from('visit_capture')
    .insert({
      organization_id: orgId,
      report_id: input.reportId,
      site_id: input.siteId,
      dossier_id: dossierId,
      kind: input.kind,
      status: 'captured',
      // Seul le vocal a une couche à poser aujourd'hui (transcription) → 'pending' ;
      // les autres gestes n'ont rien à pré-calculer → 'ready' direct.
      processing_stage: input.kind === 'vocal' ? 'pending' : 'ready',
      body: input.body ?? null,
      transcript_status: input.transcriptStatus ?? null,
      attachment_id: input.attachmentId ?? null,
      subject_id: input.subjectId ?? null,
      client_uuid: input.clientUuid ?? null,
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      captured_at: input.capturedAt ?? null,
      viewpoint_of: input.viewpointOf ?? null,
      starred: input.starred ?? false,
      annotated_original_id: input.annotatedOriginalId ?? null,
      created_by: input.createdBy,
    })
    .select('id')
    .single()
  if (error) {
    // Course idempotente : un re-drain concurrent a inséré entre-temps (mig 177).
    if ((error as { code?: string }).code === '23505' && input.clientUuid) {
      const { data: raced } = await supabase
        .from('visit_capture')
        .select('id')
        .eq('client_uuid', input.clientUuid)
        .maybeSingle()
      if (raced) return (raced as { id: string }).id
    }
    throw error
  }
  return (data as { id: string }).id
}

/** L'id d'une capture déjà déposée pour ce client_uuid, s'il existe (idempotence
 *  du drain : évite de ré-uploader un média dont la capture est déjà acquise). */
export async function findVisitCaptureIdByClientUuid(clientUuid: string): Promise<string | null> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('visit_capture')
    .select('id')
    .eq('client_uuid', clientUuid)
    .maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}

/** Les captures d'une visite, dans l'ordre du terrain (timeline du panier).
 *  Ordonnées sur l'instant RÉEL quand il existe (import : captured_at), sinon sur
 *  l'insertion (direct : captured_at NULL → tie-break created_at). C'est ce double
 *  tri qui « remet dans l'ordre » un lot WhatsApp arrivé en désordre (mig 184). */
export async function listVisitCaptures(reportId: string): Promise<VisitCaptureRow[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('visit_capture')
    .select('id, report_id, site_id, kind, status, body, transcript_status, attachment_id, subject_id, triage_intent, suite_status, starred, client_uuid, lat, lng, captured_at, is_viewpoint, viewpoint_of, created_at')
    .eq('report_id', reportId)
    .is('hidden_at', null) // masque un original ARCHIVÉ (remplacé par sa version annotée, mig 185)
    .order('captured_at', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as VisitCaptureRow[]
}

/** Les captures de visite rattachées à un point suivi — pour le dossier vivant. */
export async function listVisitCapturesBySubject(subjectId: string): Promise<VisitCaptureRow[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('visit_capture')
    .select('id, report_id, site_id, kind, status, body, transcript_status, attachment_id, subject_id, triage_intent, suite_status, starred, client_uuid, lat, lng, captured_at, is_viewpoint, viewpoint_of, created_at')
    .eq('subject_id', subjectId)
    .neq('status', 'discarded')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as VisitCaptureRow[]
}

/**
 * Toutes les captures non écartées d'un SITE (toutes visites confondues) — la
 * matière brute pour la lecture AO d'une prévisite. Plus récentes d'abord.
 */
export async function listVisitCapturesBySite(siteId: string, limit = 300): Promise<VisitCaptureRow[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('visit_capture')
    .select('id, report_id, site_id, kind, status, body, transcript_status, attachment_id, subject_id, triage_intent, suite_status, starred, client_uuid, lat, lng, captured_at, is_viewpoint, viewpoint_of, created_at')
    .eq('site_id', siteId)
    .neq('status', 'discarded')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as VisitCaptureRow[]
}

/**
 * Les captures non écartées d'un DOSSIER (opération) — la matière brute d'une
 * prévisite, scopée à l'opération et non au lieu (un même site peut porter
 * plusieurs dossiers). Plus récentes d'abord.
 */
export async function listVisitCapturesByDossier(dossierId: string, limit = 300): Promise<VisitCaptureRow[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('visit_capture')
    .select('id, report_id, site_id, kind, status, body, transcript_status, attachment_id, subject_id, triage_intent, suite_status, starred, client_uuid, lat, lng, captured_at, is_viewpoint, viewpoint_of, created_at')
    .eq('dossier_id', dossierId)
    .neq('status', 'discarded')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as VisitCaptureRow[]
}

/**
 * Captures GÉOLOCALISÉES d'un site (lat/lng non nuls), avec le nom du point suivi
 * concerné s'il existe — pour la carte des observations (« où ET quoi »). La carte
 * est une LECTURE du journal, pas un module ; ce loader la nourrit.
 */
export interface GeoCapture {
  id: string
  kind: VisitCaptureKind
  lat: number
  lng: number
  created_at: string
  body: string | null
  report_id: string
  subject_name: string | null
}

export async function listGeolocatedCapturesBySite(siteId: string, limit = 1000): Promise<GeoCapture[]> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('visit_capture')
    .select('id, kind, lat, lng, created_at, body, report_id, subject_id')
    .eq('site_id', siteId)
    .neq('status', 'discarded')
    .not('lat', 'is', null)
    .not('lng', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit)
  const rows = (data ?? []) as Array<{
    id: string; kind: VisitCaptureKind; lat: number; lng: number; created_at: string
    body: string | null; report_id: string; subject_id: string | null
  }>
  const subjectIds = [...new Set(rows.map((r) => r.subject_id).filter((x): x is string => !!x))]
  const nameById = new Map<string, string>()
  if (subjectIds.length > 0) {
    const { data: subs } = await supabase.from('subjects').select('id, name').in('id', subjectIds)
    for (const s of (subs ?? []) as Array<{ id: string; name: string }>) nameById.set(s.id, s.name)
  }
  return rows.map((r) => ({
    id: r.id, kind: r.kind, lat: r.lat, lng: r.lng, created_at: r.created_at, body: r.body,
    report_id: r.report_id, subject_name: r.subject_id ? nameById.get(r.subject_id) ?? null : null,
  }))
}

/**
 * URLs signées d'aperçu pour les captures avec pièce (photo/vidéo/vocal) — pour
 * que le débrief montre le CONTENU (miniature, lecteur), pas juste « Photo ».
 * Sans ça on trie à l'aveugle. Retourne une map captureId → { url, mime }.
 */
// ── Points de repère photographiques (mig 195) ───────────────────────────────

/** Épingle / désépingle une photo comme point de repère (ancre de série). */
export async function setCaptureViewpoint(captureId: string, isViewpoint: boolean): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('visit_capture')
    .update({ is_viewpoint: isViewpoint, updated_at: new Date().toISOString() })
    .eq('id', captureId)
    .eq('kind', 'photo')
  if (error) throw error
}

/** Toutes les photos d'un chantier appartenant à une série de point de repère
 *  (ancres + reprises), toutes visites confondues. Le regroupement en séries
 *  est fait par groupViewpointChains (pur). */
export async function listSiteViewpointRows(siteId: string): Promise<VisitCaptureRow[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('visit_capture')
    .select('id, report_id, site_id, kind, status, body, transcript_status, attachment_id, subject_id, triage_intent, suite_status, starred, client_uuid, lat, lng, captured_at, is_viewpoint, viewpoint_of, created_at')
    .eq('site_id', siteId)
    .eq('kind', 'photo')
    .neq('status', 'discarded')
    .is('hidden_at', null)
    .or('is_viewpoint.eq.true,viewpoint_of.not.is.null')
    .order('created_at', { ascending: true })
    .limit(400)
  if (error) throw error
  return (data ?? []) as VisitCaptureRow[]
}

export async function getVisitCapturePreviewUrls(
  captures: VisitCaptureRow[],
): Promise<Record<string, { url: string; mime: string | null }>> {
  const withAtt = captures.filter((c) => c.attachment_id)
  if (withAtt.length === 0) return {}
  const supabase = createAdminClient()
  const attIds = [...new Set(withAtt.map((c) => c.attachment_id as string))]
  const { data: atts } = await supabase
    .from('site_report_attachments')
    .select('id, storage_path, mime_type')
    .in('id', attIds)
  const byAttId = new Map(
    ((atts ?? []) as Array<{ id: string; storage_path: string | null; mime_type: string | null }>)
      .map((a) => [a.id, a]),
  )
  const paths = [...new Set(
    (atts ?? []).map((a) => (a as { storage_path: string | null }).storage_path).filter((p): p is string => !!p),
  )]
  if (paths.length === 0) return {}
  const { data: signed } = await supabase.storage.from('site-reports').createSignedUrls(paths, 3600)
  const urlByPath = new Map(
    ((signed ?? []) as Array<{ path: string | null; signedUrl: string }>)
      .filter((s) => s.path && s.signedUrl)
      .map((s) => [s.path as string, s.signedUrl]),
  )
  const out: Record<string, { url: string; mime: string | null }> = {}
  for (const c of withAtt) {
    const a = byAttId.get(c.attachment_id as string)
    if (!a?.storage_path) continue
    const url = urlByPath.get(a.storage_path)
    if (url) out[c.id] = { url, mime: a.mime_type }
  }
  return out
}

/** Une capture géolocalisée du chantier, prête pour la carte (forme MapCapture). */
export interface SiteMapCapture {
  id: string
  kind: string
  lat: number
  lng: number
  created_at: string
  body: string | null
  reportId: string
  subjectName: string | null
}

/**
 * TOUTES les captures géolocalisées d'un chantier (pas seulement la dernière
 * visite) — pour la « Carte mémoire » du Patrimoine. On n'expose que ce qui a de
 * vraies coordonnées ; aucune zone inventée, aucun tracking de personne.
 */
export async function listSiteMapCaptures(siteId: string): Promise<SiteMapCapture[]> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('visit_capture')
    .select('id, kind, lat, lng, body, captured_at, created_at, report_id')
    .eq('site_id', siteId)
    .not('lat', 'is', null)
    .not('lng', 'is', null)
    .neq('status', 'discarded')
    .order('created_at', { ascending: false })
    .limit(500)
  return ((data ?? []) as Array<{ id: string; kind: string; lat: number; lng: number; body: string | null; captured_at: string | null; created_at: string; report_id: string }>)
    .map((c) => ({
      id: c.id, kind: c.kind, lat: c.lat, lng: c.lng,
      created_at: c.captured_at ?? c.created_at, body: c.body?.trim() || null,
      reportId: c.report_id, subjectName: null,
    }))
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
  decision: {
    status: 'kept' | 'discarded'
    intent: CaptureTriageIntent
    /** Commentaire optionnel (« ce que la capture montre ») — stocké dans body.
     *  À NE passer que pour une photo/vidéo (body vide), jamais un vocal/note
     *  (body = transcription/texte, à ne pas écraser). */
    comment?: string | null
  },
): Promise<void> {
  const supabase = createAdminClient()
  const patch: Record<string, unknown> = {
    status: decision.status,
    triage_intent: decision.intent,
    updated_at: new Date().toISOString(),
  }
  if (decision.comment !== undefined) patch.body = decision.comment?.trim() || null
  const { error } = await supabase
    .from('visit_capture')
    .update(patch)
    .eq('id', captureId)
  if (error) throw error
}

/** Marque/démarque une capture « à réutiliser dans le mémoire technique » (mig 174). */
export async function setCaptureStarred(captureId: string, starred: boolean): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('visit_capture')
    .update({ starred, updated_at: new Date().toISOString() })
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
