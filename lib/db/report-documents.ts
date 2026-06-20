// Sprint 1 — Accès DB aux documents générés depuis une réunion (table 120).
// Lectures + écritures via service-role (admin client), comme le reste des
// données site-scoped (réserves, actions, sujets, handover). Les surfaces
// appelantes sont gardées par rôle (meetings = admin/manager). NB : on ne lit
// PAS en client RLS ici — sinon un doc fraîchement créé (org stampé à l'insert)
// peut ne pas être relu si l'org ne matche pas exactement la policy → brouillon
// invisible après génération.

import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgId } from '@/lib/db/users'
import type { DbReportDocument, ReportDocumentSection } from '@/types/db'

const COLS =
  'id, organization_id, report_id, site_id, template_key, sections, status, document_id, pdf_path, final_document_id, final_path, finalized_at, finalized_by, provider, model, prompt_version, created_by, created_at, updated_at'

export async function createReportDocument(input: {
  report_id: string
  site_id: string | null
  template_key: string
  sections: ReportDocumentSection[]
  provider: string | null
  model: string | null
  prompt_version: string | null
  created_by: string | null
}): Promise<string> {
  const supabase = createAdminClient()
  const organization_id = await getOrgId().catch(() => null)
  const { data, error } = await supabase
    .from('report_documents')
    .insert({
      organization_id,
      report_id: input.report_id,
      site_id: input.site_id,
      template_key: input.template_key,
      sections: input.sections,
      status: 'draft',
      provider: input.provider,
      model: input.model,
      prompt_version: input.prompt_version,
      created_by: input.created_by,
    })
    .select('id')
    .single()
  if (error || !data) throw error ?? new Error('No id')
  return data.id as string
}

/** Dernier document généré pour une réunion (1 PV par réunion au MVP). */
export async function getLatestReportDocument(reportId: string): Promise<DbReportDocument | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('report_documents')
    .select(COLS)
    .eq('report_id', reportId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  return data as unknown as DbReportDocument
}

export async function getReportDocument(id: string): Promise<DbReportDocument | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('report_documents')
    .select(COLS)
    .eq('id', id)
    .maybeSingle()
  if (error || !data) return null
  return data as unknown as DbReportDocument
}

/** Mise à jour des sections (édition humaine). Refuse si déjà validé. */
export async function updateReportDocumentSections(
  id: string,
  sections: ReportDocumentSection[],
): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('report_documents')
    .update({ sections, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'draft')
  if (error) throw error
}

/** Fige le PV et le relie au document de mémoire créé dans /documents. */
export async function validateReportDocument(
  id: string,
  opts: { document_id?: string | null; pdf_path?: string | null } = {},
): Promise<void> {
  const supabase = createAdminClient()
  const update: Record<string, unknown> = { status: 'validated', updated_at: new Date().toISOString() }
  if (opts.document_id !== undefined) update.document_id = opts.document_id
  if (opts.pdf_path !== undefined) update.pdf_path = opts.pdf_path
  const { error } = await supabase.from('report_documents').update(update).eq('id', id)
  if (error) throw error
}

/**
 * Pose la VERSION FINALE DIFFUSÉE (téléversée par l'humain) sur la ligne de suivi
 * de la réunion (get-or-create). N'écrase PAS la mémoire ni les sections : on ne
 * fait que tracer le document final et sa date. Vérité juridique (mig 126).
 */
export async function setReportDocumentFinal(input: {
  report_id: string
  site_id: string | null
  final_document_id: string | null
  final_path: string
  finalized_by: string | null
}): Promise<void> {
  const supabase = createAdminClient()
  const existing = await getLatestReportDocument(input.report_id)
  let rowId = existing?.id
  if (!rowId) {
    rowId = await createReportDocument({
      report_id: input.report_id,
      site_id: input.site_id,
      template_key: 'cr_chantier_v1',
      sections: [],
      provider: null,
      model: null,
      prompt_version: null,
      created_by: input.finalized_by,
    })
  }
  const { error } = await supabase
    .from('report_documents')
    .update({
      final_document_id: input.final_document_id,
      final_path: input.final_path,
      finalized_at: new Date().toISOString(),
      finalized_by: input.finalized_by,
      updated_at: new Date().toISOString(),
    })
    .eq('id', rowId)
  if (error) throw error
}

export async function markReportDocumentExported(id: string, pdfPath: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('report_documents')
    .update({ status: 'exported', pdf_path: pdfPath, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}
