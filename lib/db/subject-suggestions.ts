import { createAdminClient } from '@/lib/supabase/admin'

export type SubjectSuggestionRow = {
  id: string
  subject_thread_id: string | null  // null pour les suggestions issues de propositions terrain
  extraction_run_id: string | null
  source_proposal_id: string | null // null pour les suggestions issues de PV/extraction
  proposal_label: string
  proposal_family: string
  candidate_canonical_subject_id: string | null
  candidate_label: string | null
  model_confidence: number | null
  reasoning: string | null
  shadow_decision: string
  resolution: string
  resolver_version: string
  resolved_at: string | null
  resolved_by: string | null
}

export type SiteSubjectSuggestionRow = SubjectSuggestionRow & {
  origin_label: string | null  // filename du document source
  origin_date: string | null   // effective_date du document ou date du run
}

type RawRow = {
  id: string
  subject_thread_id: string | null
  extraction_run_id: string | null
  source_proposal_id: string | null
  proposal_label: string
  proposal_family: string
  candidate_canonical_subject_id: string | null
  model_confidence: number | null
  reasoning: string | null
  shadow_decision: string
  resolution: string
  resolver_version: string
  resolved_at: string | null
  resolved_by: string | null
}

/**
 * Charge les suggestions sémantiques pour la section "Rapprochements suggérés".
 *
 * Inclut :
 *   - suggestions liées à ce run (extraction_run_id = runId)
 *   - suggestions rétroactives du site (extraction_run_id IS NULL, site_id = siteId)
 *
 * Toutes les résolutions (pending / accepted / rejected) sont incluses pour l'affichage.
 * Seules les suggestions avec candidat réel et shadow_decision utile sont retournées.
 */
export async function listSuggestionsForReview(
  runId: string,
  siteId: string | null,
): Promise<SubjectSuggestionRow[]> {
  const admin = createAdminClient()

  const BASE_SELECT = `
    id, subject_thread_id, extraction_run_id, source_proposal_id, proposal_label, proposal_family,
    candidate_canonical_subject_id, model_confidence, reasoning,
    shadow_decision, resolution, resolver_version, resolved_at, resolved_by
  `
  const USEFUL_DECISIONS = ['would_suggest', 'would_auto_assign']

  // 1. Suggestions liées au run courant
  const { data: runRows } = await admin
    .from('canonical_subject_suggestion')
    .select(BASE_SELECT)
    .eq('extraction_run_id', runId)
    .in('shadow_decision', USEFUL_DECISIONS)
    .not('candidate_canonical_subject_id', 'is', null)
    .order('created_at', { ascending: false })

  // 2. Suggestions rétroactives du site (sans run)
  let siteRows: RawRow[] = []
  if (siteId) {
    const { data } = await admin
      .from('canonical_subject_suggestion')
      .select(BASE_SELECT)
      .is('extraction_run_id', null)
      .eq('site_id', siteId)
      .in('shadow_decision', USEFUL_DECISIONS)
      .not('candidate_canonical_subject_id', 'is', null)
      .order('created_at', { ascending: false })
    siteRows = (data as RawRow[] | null) ?? []
  }

  const allRows: RawRow[] = [...((runRows as RawRow[] | null) ?? []), ...siteRows]
  if (allRows.length === 0) return []

  // Dédupliquer par id (un thread ne doit apparaître qu'une fois)
  const seen = new Set<string>()
  const deduped = allRows.filter((r) => {
    if (seen.has(r.id)) return false
    seen.add(r.id)
    return true
  })

  // 3. Enrichir avec le label du canonical_subject candidat
  const csIds = [...new Set(deduped.map((r) => r.candidate_canonical_subject_id).filter(Boolean) as string[])]
  const csLabelMap = new Map<string, string>()

  if (csIds.length > 0) {
    const { data: csRows } = await admin
      .from('canonical_subject')
      .select('id, label')
      .in('id', csIds)
    for (const cs of csRows ?? []) csLabelMap.set(cs.id, cs.label)
  }

  return deduped.map((row) => ({
    ...row,
    candidate_label: row.candidate_canonical_subject_id
      ? (csLabelMap.get(row.candidate_canonical_subject_id) ?? null)
      : null,
  }))
}

/**
 * Toutes les suggestions pending au niveau du chantier — vue globale "Sujets à rapprocher".
 * Triées par confiance DESC puis ancienneté ASC.
 * Enrichies avec l'origine (nom du document + date).
 */
export async function listPendingSuggestionsForSite(siteId: string): Promise<SiteSubjectSuggestionRow[]> {
  const admin = createAdminClient()
  const USEFUL_DECISIONS = ['would_suggest', 'would_auto_assign']

  const VISIT_BASE_SELECT = `
    id, subject_thread_id, extraction_run_id, source_proposal_id, proposal_label, proposal_family,
    candidate_canonical_subject_id, model_confidence, reasoning,
    shadow_decision, resolution, resolver_version, resolved_at, resolved_by
  `

  const { data: rows } = await admin
    .from('canonical_subject_suggestion')
    .select(VISIT_BASE_SELECT)
    .eq('site_id', siteId)
    .eq('resolution', 'pending')
    .in('shadow_decision', USEFUL_DECISIONS)
    .not('candidate_canonical_subject_id', 'is', null)
    .order('model_confidence', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: true })

  const allRows = (rows as RawRow[] | null) ?? []
  if (allRows.length === 0) return []

  // Origine PV : filename + date depuis document_extraction_run → documents
  const runIds = [...new Set(
    allRows.map(r => r.extraction_run_id).filter((id): id is string => id !== null)
  )]
  type RunMeta = {
    id: string
    created_at: string
    documents: { filename: string; effective_date: string | null } | null
  }
  const runMetaMap = new Map<string, { origin_label: string | null; origin_date: string | null }>()
  if (runIds.length > 0) {
    const { data: runRows } = await admin
      .from('document_extraction_run')
      .select('id, created_at, documents!document_id(filename, effective_date)')
      .in('id', runIds)
    for (const r of (runRows as RunMeta[] | null) ?? []) {
      runMetaMap.set(r.id, {
        origin_label: r.documents?.filename ?? null,
        origin_date: r.documents?.effective_date ?? r.created_at.slice(0, 10),
      })
    }
  }

  // Origine terrain : date de visite depuis site_knowledge_proposals → site_reports
  const visitProposalIds = [...new Set(
    allRows
      .filter(r => r.extraction_run_id === null && r.source_proposal_id !== null)
      .map(r => r.source_proposal_id as string)
  )]
  type ProposalReportRow = {
    id: string
    site_reports: { started_at: string | null; created_at: string } | null
  }
  const visitOriginMap = new Map<string, { origin_label: string | null; origin_date: string | null }>()
  if (visitProposalIds.length > 0) {
    const { data: propRows } = await admin
      .from('site_knowledge_proposals')
      .select('id, site_reports!report_id(started_at, created_at)')
      .in('id', visitProposalIds)
    for (const p of (propRows as ProposalReportRow[] | null) ?? []) {
      const r = p.site_reports
      visitOriginMap.set(p.id, {
        origin_label: 'Visite terrain',
        origin_date: (r?.started_at ?? r?.created_at ?? null)?.slice(0, 10) ?? null,
      })
    }
  }

  // Labels canonical_subject
  const csIds = [...new Set(
    allRows.map(r => r.candidate_canonical_subject_id).filter((id): id is string => id !== null)
  )]
  const csLabelMap = new Map<string, string>()
  if (csIds.length > 0) {
    const { data: csRows } = await admin.from('canonical_subject').select('id, label').in('id', csIds)
    for (const cs of csRows ?? []) csLabelMap.set(cs.id, cs.label)
  }

  return allRows.map(row => {
    let meta: { origin_label: string | null; origin_date: string | null } | null = null
    if (row.extraction_run_id) {
      meta = runMetaMap.get(row.extraction_run_id) ?? null
    } else if (row.source_proposal_id) {
      meta = visitOriginMap.get(row.source_proposal_id) ?? null
    }
    return {
      ...row,
      candidate_label: row.candidate_canonical_subject_id
        ? (csLabelMap.get(row.candidate_canonical_subject_id) ?? null)
        : null,
      origin_label: meta?.origin_label ?? null,
      origin_date: meta?.origin_date ?? null,
    }
  })
}
