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
}): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('site_report_attachments')
    .insert({
      report_id: input.report_id,
      kind: input.kind,
      storage_path: input.storage_path,
      filename: input.filename ?? null,
      mime_type: input.mime_type ?? null,
      size_bytes: input.size_bytes ?? null,
      sha256: input.sha256 ?? null,
      client_uuid: input.client_uuid ?? null,
    })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

// ── Lecture ─────────────────────────────────────────────────────────────────

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
    .neq('status', 'draft')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data as DbSiteReport[]) ?? []
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
