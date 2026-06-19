// Sprint 1 — Accès DB aux documents générés depuis une réunion (table 120).
// Écritures via service-role (server actions gardées) ; lectures via RLS.

import { createClient as createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgId } from '@/lib/db/users'
import type { DbReportDocument, ReportDocumentSection } from '@/types/db'

const COLS =
  'id, organization_id, report_id, site_id, template_key, sections, status, document_id, pdf_path, provider, model, prompt_version, created_by, created_at, updated_at'

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
  const supabase = await createServerClient()
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
  const supabase = await createServerClient()
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

export async function markReportDocumentExported(id: string, pdfPath: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('report_documents')
    .update({ status: 'exported', pdf_path: pdfPath, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}
