'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getUserRoleById } from '@/lib/db/users'
import { getOrgIdsOfUser } from '@/lib/auth/memberships'

export async function regenerateNarrativeAction(fd: FormData): Promise<{ ok: boolean; error?: string }> {
  const siteReportId = fd.get('site_report_id')?.toString()
  const runId = fd.get('run_id')?.toString()
  if (!siteReportId || !runId) return { ok: false, error: 'Paramètres manquants' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Non authentifié' }

  const admin = createAdminClient()

  // Vérification d'accès via organisation du chantier
  const { data: sr } = await admin.from('site_reports').select('site_id').eq('id', siteReportId).maybeSingle()
  if (!sr) return { ok: false, error: 'Visite introuvable' }
  const siteId = (sr as { site_id: string }).site_id
  const { data: site } = await admin.from('sites').select('organization_id').eq('id', siteId).maybeSingle()
  const orgId = (site as { organization_id: string } | null)?.organization_id
  if (!orgId) return { ok: false, error: 'Chantier introuvable' }

  const role = await getUserRoleById(user.id)
  if (role !== 'admin') {
    const orgIds = await getOrgIdsOfUser()
    if (!orgIds.includes(orgId)) return { ok: false, error: 'Accès refusé' }
  }

  // Propositions confirmées pour le récit
  const { data: narProps } = await admin
    .from('document_extraction_proposal')
    .select('proposal_family, label, reviewed_label, description, reviewed_description, source_payload')
    .eq('extraction_run_id', runId)
    .in('review_status', ['accepted', 'edited', 'materialized'])
    .in('proposal_family', ['knowledge_fact', 'action', 'deadline', 'decision', 'reservation', 'observation'])

  if (!narProps?.length) return { ok: false, error: 'Aucune proposition confirmée' }

  type NarProp = {
    proposal_family: string; label: string; reviewed_label: string | null
    description: string | null; reviewed_description: string | null
    source_payload: { statusAtDocumentDate?: string } | null
  }
  const proposals = (narProps as NarProp[]).map((p) => ({
    family: p.proposal_family,
    label: p.reviewed_label ?? p.label,
    description: p.reviewed_description ?? p.description ?? null,
    statusAtDocumentDate: (p.source_payload as { statusAtDocumentDate?: string } | null)?.statusAtDocumentDate ?? null,
  }))

  const { generateHistoricalVisitNarrative } = await import('@/lib/documents/historical-visit-narrator')
  const narrative = await generateHistoricalVisitNarrative(proposals)
  if (!narrative) return { ok: false, error: 'La génération a échoué' }

  const { data: existing } = await admin.from('site_reports').select('debrief_analysis').eq('id', siteReportId).maybeSingle()
  const existingDa = (existing as { debrief_analysis: Record<string, unknown> | null } | null)?.debrief_analysis ?? {}
  const { error } = await admin.from('site_reports').update({
    debrief_analysis: {
      ...existingDa,
      historical_summary: {
        text: narrative,
        generatedAt: new Date().toISOString(),
        runId,
        model: process.env.AI_MODEL ?? 'gemini-2.5-flash',
      },
    },
  }).eq('id', siteReportId)

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
