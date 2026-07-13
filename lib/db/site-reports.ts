// lib/db/site-reports.ts
// Couche d'accès aux comptes-rendus multimodaux de chantier (migration 099).
// Conventions : createAdminClient (RLS service-role), throw-on-error.
// Doctrine : l'artefact brut n'est jamais supprimé ; l'IA propose, l'humain valide.

import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgId } from '@/lib/db/users'
import type {
  DbSiteReport,
  DbSiteReportAttachment,
  DbSiteReportProposal,
  SiteReportAttachmentKind,
  SiteReportParticipant,
  SiteReportProposalType,
  SiteReportRisk,
  SiteReportStatus,
  SiteReportTranscriptStatus,
  SiteReportType,
} from '@/types/db'

// ── Création du compte-rendu ────────────────────────────────────────────────

export async function createSiteReport(input: {
  type?: SiteReportType
  site_id?: string | null
  contract_id?: string | null
  title?: string | null
  tenant_id: string
  created_by: string | null
  audio_path?: string | null
  audio_mime?: string | null
  audio_duration_seconds?: number | null
  text_input?: string | null
  transcript_status?: SiteReportTranscriptStatus
}): Promise<string> {
  const supabase = createAdminClient()
  const orgId = await getOrgId()
  const { data, error } = await supabase
    .from('site_reports')
    .insert({
      type: input.type ?? 'site',
      site_id: input.site_id ?? null,
      contract_id: input.contract_id ?? null,
      title: input.title ?? null,
      tenant_id: input.tenant_id,
      organization_id: orgId,
      created_by: input.created_by,
      status: 'draft' as SiteReportStatus,
      audio_path: input.audio_path ?? null,
      audio_mime: input.audio_mime ?? null,
      audio_duration_seconds: input.audio_duration_seconds ?? null,
      text_input: input.text_input ?? null,
      transcript_status: input.transcript_status ?? 'none',
    })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

/** Enregistre les sites touchés par un compte-rendu (idempotent). */
export async function addReportSites(reportId: string, siteIds: string[]): Promise<void> {
  const unique = Array.from(new Set(siteIds.filter(Boolean)))
  if (unique.length === 0) return
  const supabase = createAdminClient()
  const rows = unique.map((site_id) => ({ report_id: reportId, site_id }))
  const { error } = await supabase
    .from('report_sites')
    .upsert(rows, { onConflict: 'report_id,site_id', ignoreDuplicates: true })
  if (error) throw error
}

// ── Pièces jointes ──────────────────────────────────────────────────────────

export async function addReportAttachment(input: {
  report_id: string
  kind: SiteReportAttachmentKind
  storage_path: string
  filename?: string | null
  mime_type?: string | null
  size_bytes?: number | null
  sha256?: string | null
  client_uuid?: string | null
  // Mémoire enrichissable après réunion (mig 163) — PJ post-réunion tracée.
  uploaded_after_meeting?: boolean
  added_by?: string | null
  // Source audio d'une réunion (migs 141 + 193) — chaque source conserve son
  // origine, ses horaires, sa durée et son statut de traitement.
  label?: string | null
  type_source?: 'audio_meeting' | 'voice_note' | 'phone_call' | 'debrief' | 'other'
  duration_seconds?: number | null
  transcript_status?: 'none' | 'pending' | 'done' | 'failed'
  // 'os_share' (mig 201) : arrivé par le partage Android. Ce n'est pas un
  // « import d'origine inconnue » — on sait exactement d'où il vient.
  source_origin?: 'memoria' | 'phone' | 'import' | 'os_share' | null
  recorded_started_at?: string | null
  recorded_ended_at?: string | null
}): Promise<string> {
  const supabase = createAdminClient()
  const row: Record<string, unknown> = {
    report_id: input.report_id,
    kind: input.kind,
    storage_path: input.storage_path,
    filename: input.filename ?? null,
    mime_type: input.mime_type ?? null,
    size_bytes: input.size_bytes ?? null,
    sha256: input.sha256 ?? null,
    client_uuid: input.client_uuid ?? null,
    uploaded_after_meeting: input.uploaded_after_meeting ?? false,
    added_by: input.added_by ?? null,
    added_at: input.uploaded_after_meeting ? new Date().toISOString() : null,
  }
  // Champs de source audio : posés seulement s'ils sont fournis, pour ne pas
  // écraser les défauts SQL (transcript_status 'none') sur les autres kinds.
  if (input.label !== undefined) row.label = input.label
  if (input.type_source !== undefined) row.type_source = input.type_source
  if (input.duration_seconds !== undefined) row.duration_seconds = input.duration_seconds
  if (input.transcript_status !== undefined) row.transcript_status = input.transcript_status
  if (input.source_origin !== undefined) row.source_origin = input.source_origin
  if (input.recorded_started_at !== undefined) row.recorded_started_at = input.recorded_started_at
  if (input.recorded_ended_at !== undefined) row.recorded_ended_at = input.recorded_ended_at
  const { data, error } = await supabase
    .from('site_report_attachments')
    .insert(row)
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

// ── Lecture ─────────────────────────────────────────────────────────────────

/**
 * Indicateur factuel « CR réalisés » d'un site (jamais un % ni un score).
 *   - meetings  : réunions = comptes-rendus classiques (origin null, pas les visites).
 *   - crDone    : réunions avec ≥1 version finale FIGÉE (report_final_versions, mig 127).
 *   - lastCrDate: date du dernier CR figé.
 */
export async function getSiteCrStats(siteId: string): Promise<{ meetings: number; crDone: number; lastCrDate: string | null }> {
  const supabase = createAdminClient()
  const { data: meetingRows } = await supabase
    .from('site_reports').select('id').eq('site_id', siteId).is('origin', null)
  const ids = ((meetingRows ?? []) as Array<{ id: string }>).map((r) => r.id)
  if (ids.length === 0) return { meetings: 0, crDone: 0, lastCrDate: null }
  const { data: fvRows } = await supabase
    .from('report_final_versions').select('report_id, finalized_at').in('report_id', ids)
  const fv = (fvRows ?? []) as Array<{ report_id: string; finalized_at: string }>
  const crDone = new Set(fv.map((r) => r.report_id)).size
  const lastCrDate = fv.reduce<string | null>((max, r) => (!max || r.finalized_at > max ? r.finalized_at : max), null)
  return { meetings: ids.length, crDone, lastCrDate }
}

/**
 * Mémoire de présence du chantier : sur les réunions PASSÉES, combien de fois
 * chaque contact a été présent + qui était à la dernière réunion. Déterministe
 * (pas d'IA). Sert « habituels / occasionnels / nouveaux » et « reprendre la
 * dernière réunion ». « Présent » = présence P ou non renseignée (pas AE/AN).
 */
export interface SiteAttendanceStats {
  totalMeetings: number
  present: Record<string, number>   // contactId → nb de réunions où présent
  lastMeetingContactIds: string[]
}

export async function getSiteAttendanceStats(siteId: string, excludeReportId: string): Promise<SiteAttendanceStats> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('site_reports')
    .select('participants, created_at')
    .eq('site_id', siteId)
    .is('origin', null)
    .neq('id', excludeReportId)
    .order('created_at', { ascending: false })
    .limit(50)
  const rows = (data ?? []) as Array<{ participants: SiteReportParticipant[] | null; created_at: string }>
  const wasPresent = (p: SiteReportParticipant) => !!p.contactId && p.presence !== 'AE' && p.presence !== 'AN'
  const present: Record<string, number> = {}
  for (const r of rows) {
    for (const p of r.participants ?? []) {
      if (wasPresent(p)) present[p.contactId as string] = (present[p.contactId as string] ?? 0) + 1
    }
  }
  const lastMeetingContactIds = rows.length > 0
    ? (rows[0].participants ?? []).filter(wasPresent).map((p) => p.contactId as string)
    : []
  return { totalMeetings: rows.length, present, lastMeetingContactIds }
}

export async function getSiteReport(id: string): Promise<DbSiteReport | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('site_reports')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data as DbSiteReport | null) ?? null
}

export async function listAttachments(reportId: string): Promise<DbSiteReportAttachment[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('site_report_attachments')
    .select('*')
    .eq('report_id', reportId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data as DbSiteReportAttachment[]) ?? []
}

export async function listProposals(reportId: string): Promise<DbSiteReportProposal[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('site_report_proposals')
    .select('*')
    .eq('report_id', reportId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data as DbSiteReportProposal[]) ?? []
}

/** Comptes-rendus touchant un site (via report_sites OU site_id direct), pour
 *  le journal. Couvre les réunions contrat qui ont routé une décision vers ce
 *  site. Exclut les brouillons jamais aboutis. */
export async function listReportsBySite(siteId: string): Promise<DbSiteReport[]> {
  const supabase = createAdminClient()
  const { data: links } = await supabase
    .from('report_sites')
    .select('report_id')
    .eq('site_id', siteId)
  const linkedIds = ((links ?? []) as Array<{ report_id: string }>).map((l) => l.report_id)

  // OR : site principal direct (réunion site) OU lien report_sites (réunion contrat).
  const orParts = [`site_id.eq.${siteId}`]
  if (linkedIds.length > 0) orParts.push(`id.in.(${linkedIds.join(',')})`)

  const { data, error } = await supabase
    .from('site_reports')
    .select('*')
    .or(orParts.join(','))
    // Réunions uniquement : les visites terrain (origin non-null, mig 162) ont
    // leurs propres écrans et ne doivent jamais apparaître dans cette liste.
    .is('origin', null)
    .neq('status', 'draft')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data as DbSiteReport[]) ?? []
}

// ── Listing « Réunions » (cockpit dédié) ────────────────────────────────────

export interface MeetingListRow {
  id: string
  type: SiteReportType
  title: string | null
  status: SiteReportStatus
  createdAt: string
  contractId: string | null
  contractName: string | null
  siteNames: string[]
  /** Décisions détectées (propositions, tous statuts). */
  decisionCount: number
  /** Actions encore ouvertes nées de cette réunion. */
  openActionCount: number
  /** Blocages / dépendances détectés (risks de type dependency|risk). */
  blockerCount: number
  /** Les blocages eux-mêmes (pour la vue groupée par réunion). */
  blockers: SiteReportRisk[]
}

/** Toutes les réunions de l'organisation, enrichies pour la liste /meetings.
 *  Résilient : si le socle compte-rendu n'est pas encore migré, renvoie []. */
export async function listMeetings(): Promise<MeetingListRow[]> {
  const supabase = createAdminClient()
  const orgId = await getOrgId()

  // Réunion = site_reports SANS origin (les visites terrain — origin
  // 'planned'/'spontaneous'/'qr'/'gps', mig 162 — ont leurs propres écrans et
  // ne doivent JAMAIS apparaître ici). Filtre absent à l'origine : les captures
  // de visite fuyaient dans l'écran Réunions.
  let q = supabase
    .from('site_reports')
    .select('*')
    .is('origin', null)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
  if (orgId) q = q.eq('organization_id', orgId)
  const { data, error } = await q
  if (error) return [] // socle non migré → cockpit vide plutôt que crash
  const reports = (data ?? []) as DbSiteReport[]
  if (reports.length === 0) return []
  const reportIds = reports.map((r) => r.id)

  // Contrats
  const contractIds = [...new Set(reports.map((r) => r.contract_id).filter((v): v is string => !!v))]
  const contractName = new Map<string, string>()
  if (contractIds.length > 0) {
    const { data: cs } = await supabase.from('contracts').select('id, name').in('id', contractIds)
    for (const c of (cs ?? []) as Array<{ id: string; name: string }>) contractName.set(c.id, c.name)
  }

  // Sites touchés : report_sites (M:N) + site_id direct
  const { data: linkRows } = await supabase
    .from('report_sites')
    .select('report_id, site_id')
    .in('report_id', reportIds)
  const links = (linkRows ?? []) as Array<{ report_id: string; site_id: string }>
  const sitesByReport = new Map<string, Set<string>>()
  for (const r of reports) {
    const set = new Set<string>()
    if (r.site_id) set.add(r.site_id)
    sitesByReport.set(r.id, set)
  }
  for (const l of links) sitesByReport.get(l.report_id)?.add(l.site_id)

  const allSiteIds = [...new Set([...sitesByReport.values()].flatMap((s) => [...s]))]
  const siteName = new Map<string, string>()
  if (allSiteIds.length > 0) {
    const { data: ss } = await supabase.from('sites').select('id, name').in('id', allSiteIds)
    for (const s of (ss ?? []) as Array<{ id: string; name: string }>) siteName.set(s.id, s.name)
  }

  // Décisions (propositions) par réunion
  const { data: propRows } = await supabase
    .from('site_report_proposals')
    .select('report_id')
    .in('report_id', reportIds)
  const decisionCount = new Map<string, number>()
  for (const p of (propRows ?? []) as Array<{ report_id: string }>) {
    decisionCount.set(p.report_id, (decisionCount.get(p.report_id) ?? 0) + 1)
  }

  // Actions ouvertes par réunion
  const { data: actRows } = await supabase
    .from('site_actions')
    .select('report_id, status')
    .in('report_id', reportIds)
  const openActionCount = new Map<string, number>()
  for (const a of (actRows ?? []) as Array<{ report_id: string | null; status: string }>) {
    if (a.report_id && a.status === 'open') {
      openActionCount.set(a.report_id, (openActionCount.get(a.report_id) ?? 0) + 1)
    }
  }

  return reports.map((r) => {
    const siteSet = sitesByReport.get(r.id) ?? new Set<string>()
    const blockers = (r.risks ?? []).filter((x) => x.kind === 'dependency' || x.kind === 'risk')
    return {
      id: r.id,
      type: r.type,
      title: r.title,
      status: r.status,
      createdAt: r.created_at,
      contractId: r.contract_id,
      contractName: r.contract_id ? contractName.get(r.contract_id) ?? null : null,
      siteNames: [...siteSet].map((id) => siteName.get(id) ?? '—'),
      decisionCount: decisionCount.get(r.id) ?? 0,
      openActionCount: openActionCount.get(r.id) ?? 0,
      blockerCount: blockers.length,
      blockers,
    }
  })
}

// ── Transitions d'état ──────────────────────────────────────────────────────

export async function setTranscript(
  id: string,
  patch: { raw?: string; corrected?: string; status: SiteReportTranscriptStatus },
): Promise<void> {
  const supabase = createAdminClient()
  const update: Record<string, unknown> = {
    transcript_status: patch.status,
    updated_at: new Date().toISOString(),
  }
  if (patch.raw !== undefined) update.transcript_raw = patch.raw
  if (patch.corrected !== undefined) update.transcript_corrected = patch.corrected
  const { error } = await supabase.from('site_reports').update(update).eq('id', id)
  if (error) throw error
}

export async function setReportStatus(
  id: string,
  status: SiteReportStatus,
  analysisError?: string | null,
): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('site_reports')
    .update({
      status,
      analysis_error: analysisError ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) throw error
}

/** Persiste la reconstruction IA (présents + risques) sur le compte-rendu. */
export async function setReportAnalysis(
  id: string,
  patch: { participants?: SiteReportParticipant[]; risks?: SiteReportRisk[] },
): Promise<void> {
  const supabase = createAdminClient()
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.participants !== undefined) update.participants = patch.participants
  if (patch.risks !== undefined) update.risks = patch.risks
  const { error } = await supabase.from('site_reports').update(update).eq('id', id)
  if (error) throw error
}

/** FUSION non destructive (P2b) : ajoute les participants/risques NOUVEAUX détectés
 *  par une ré-analyse, sans jamais supprimer l'existant. Dédup déterministe (nom
 *  normalisé pour les participants, libellé pour les risques). Renvoie le delta. */
export async function mergeReportAnalysis(
  id: string,
  incoming: { participants: SiteReportParticipant[]; risks: SiteReportRisk[] },
): Promise<{ addedParticipants: number; addedRisks: number }> {
  const supabase = createAdminClient()
  const { data } = await supabase.from('site_reports').select('participants, risks').eq('id', id).maybeSingle()
  const cur = data as { participants: SiteReportParticipant[] | null; risks: SiteReportRisk[] | null } | null
  const norm = (s: string) => s.toLowerCase().trim()
  const existingP = new Set((cur?.participants ?? []).map((p) => norm(p.name)))
  const newP = incoming.participants.filter((p) => p.name?.trim() && !existingP.has(norm(p.name)))
  const existingR = new Set((cur?.risks ?? []).map((r) => norm(r.label)))
  const newR = incoming.risks.filter((r) => r.label?.trim() && !existingR.has(norm(r.label)))
  if (newP.length === 0 && newR.length === 0) return { addedParticipants: 0, addedRisks: 0 }
  const { error } = await supabase
    .from('site_reports')
    .update({
      participants: [...(cur?.participants ?? []), ...newP],
      risks: [...(cur?.risks ?? []), ...newR],
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) throw error
  return { addedParticipants: newP.length, addedRisks: newR.length }
}

/** Met à jour le texte saisi/corrigé sans toucher au statut. */
export async function setReportText(
  id: string,
  patch: { text_input?: string | null; transcript_corrected?: string | null },
): Promise<void> {
  const supabase = createAdminClient()
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.text_input !== undefined) update.text_input = patch.text_input
  if (patch.transcript_corrected !== undefined) update.transcript_corrected = patch.transcript_corrected
  const { error } = await supabase.from('site_reports').update(update).eq('id', id)
  if (error) throw error
}

// ── Propositions IA ─────────────────────────────────────────────────────────

export async function bulkInsertProposals(input: {
  report_id: string
  origin?: 'initial' | 'reanalysis' // tag d'origine (mig 142) ; défaut 'initial'
  proposals: Array<{
    type: SiteReportProposalType
    payload: Record<string, unknown>
    short_label: string
    rationale: string | null
    category: string | null
    corps_etat: string | null
    assigned_to: string | null
    site_id: string | null
    ai_confidence: number | null
  }>
}): Promise<DbSiteReportProposal[]> {
  if (input.proposals.length === 0) return []
  const supabase = createAdminClient()
  const rows = input.proposals.map((p) => ({
    report_id: input.report_id,
    type: p.type,
    payload: p.payload,
    short_label: p.short_label,
    rationale: p.rationale,
    category: p.category,
    corps_etat: p.corps_etat,
    assigned_to: p.assigned_to,
    site_id: p.site_id,
    ai_confidence: p.ai_confidence,
    status: 'proposed' as const,
    origin: input.origin ?? 'initial',
  }))
  const { data, error } = await supabase
    .from('site_report_proposals')
    .insert(rows)
    .select('*')
  if (error) throw error
  return (data as DbSiteReportProposal[]) ?? []
}

export async function getProposal(id: string): Promise<DbSiteReportProposal | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('site_report_proposals')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data as DbSiteReportProposal | null) ?? null
}

export async function curateProposal(
  id: string,
  patch: {
    short_label?: string
    category?: string | null
    corps_etat?: string | null
    assigned_to?: string | null
    site_id?: string | null
    payload?: Record<string, unknown>
    status?: 'accepted' | 'rejected'
  },
): Promise<void> {
  const supabase = createAdminClient()
  const update: Record<string, unknown> = {}
  if (patch.short_label !== undefined) update.short_label = patch.short_label
  if (patch.category !== undefined) update.category = patch.category
  if (patch.corps_etat !== undefined) update.corps_etat = patch.corps_etat
  if (patch.assigned_to !== undefined) update.assigned_to = patch.assigned_to
  if (patch.site_id !== undefined) update.site_id = patch.site_id
  if (patch.payload !== undefined) update.payload = patch.payload
  if (patch.status !== undefined) update.status = patch.status
  if (Object.keys(update).length === 0) return
  const { error } = await supabase.from('site_report_proposals').update(update).eq('id', id)
  if (error) throw error
}

export async function markProposalCreated(
  id: string,
  entityType: string,
  entityId: string,
): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('site_report_proposals')
    .update({ created_entity_type: entityType, created_entity_id: entityId })
    .eq('id', id)
  if (error) throw error
}
