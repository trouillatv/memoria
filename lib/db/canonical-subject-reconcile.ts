import 'server-only'

// Pont synchrone : proposition terrain confirmée → occurrence canonique.
//
// Appelé après promoteProposal() pour les kinds éligibles, en fire-and-forget.
// N'est jamais bloquant : le métier (confirmation de proposition) ne dépend pas
// de la réussite de la réconciliation.
//
// Résultats possibles :
//   resolved        → occurrence créée ; canonical_subject_id renseigné
//   needs_resolution → ambiguïté ; candidats stockés dans payload, état marqué
//   not_found       → aucun sujet connu ; état marqué ; aucune occurrence
//   skipped         → kind non éligible ou source hors terrain

import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCanonicalSubjectReference } from '@/lib/db/canonical-subject-resolve'

const ELIGIBLE_KINDS = new Set(['action', 'vigilance', 'decision', 'knowledge'])

export interface ReconcileResult {
  status: 'resolved' | 'needs_resolution' | 'not_found' | 'skipped'
  canonicalSubjectId?: string
}

export async function reconcileProposalToCanonical(params: {
  proposalId: string
  siteId: string
  reportId: string          // site_reports.id — source de la date de visite
  proposalKind: string
  proposalTitle: string
  proposalBody: string | null
  proposalCreatedAt: string // fallback si le report n'a pas de date
  createdBy: string | null
}): Promise<ReconcileResult> {
  const { proposalId, siteId, reportId, proposalKind, proposalTitle, proposalBody, proposalCreatedAt, createdBy } = params

  if (!ELIGIBLE_KINDS.has(proposalKind)) return { status: 'skipped' }

  const supabase = createAdminClient()

  // Date effective + discriminant réunion/visite
  // origin IS NOT NULL → 'field_visit' ; origin IS NULL → 'meeting' (mig 162)
  const { data: reportRow } = await supabase
    .from('site_reports')
    .select('created_at, started_at, origin')
    .eq('id', reportId)
    .maybeSingle()
  type ReportRow = { created_at?: string; started_at?: string | null; origin?: string | null } | null
  const rr = reportRow as ReportRow
  const visitDate = (rr?.started_at ?? rr?.created_at ?? proposalCreatedAt).slice(0, 10)
  const sourceKind: 'field_visit' | 'meeting' = rr?.origin != null ? 'field_visit' : 'meeting'

  // Résolution 3 passes (exact → code+Jaccard → Jaccard)
  const resolution = await resolveCanonicalSubjectReference(siteId, proposalTitle)

  if (resolution.kind === 'resolved') {
    const canonicalSubjectId = resolution.candidate.id

    await supabase
      .from('canonical_subject_occurrence')
      .upsert(
        {
          canonical_subject_id: canonicalSubjectId,
          site_id: siteId,
          source_kind: sourceKind,
          source_ref_id: reportId,
          source_proposal_id: proposalId,
          visit_status: sourceKind === 'field_visit' ? 'field_checked' : 'mentioned',
          label: proposalTitle,
          note: proposalBody,
          evidence_count: 0,
          effective_date: visitDate,
          created_by: createdBy,
        },
        { onConflict: 'source_kind,source_proposal_id', ignoreDuplicates: true },
      )

    await supabase
      .from('site_knowledge_proposals')
      .update({ canonical_subject_id: canonicalSubjectId, canonical_resolution_status: 'resolved' })
      .eq('id', proposalId)

    return { status: 'resolved', canonicalSubjectId }
  }

  if (resolution.kind === 'ambiguous') {
    const { data: current } = await supabase
      .from('site_knowledge_proposals')
      .select('payload')
      .eq('id', proposalId)
      .maybeSingle()

    const updatedPayload = {
      ...((current as { payload?: Record<string, unknown> } | null)?.payload ?? {}),
      resolution_candidates: resolution.candidates.map((c) => ({ id: c.id, label: c.label })),
    }

    await supabase
      .from('site_knowledge_proposals')
      .update({ canonical_resolution_status: 'needs_resolution', payload: updatedPayload })
      .eq('id', proposalId)

    return { status: 'needs_resolution' }
  }

  // not_found
  await supabase
    .from('site_knowledge_proposals')
    .update({ canonical_resolution_status: 'not_found' })
    .eq('id', proposalId)

  return { status: 'not_found' }
}

/**
 * Résolution manuelle d'une ambiguïté : l'utilisateur choisit le canonical_subject.
 * Idempotent — une re-sélection du même canonical n'ajoute pas de doublon.
 */
export async function resolveProposalCanonicalManually(params: {
  proposalId: string
  siteId: string
  canonicalSubjectId: string
  reportId: string
  proposalTitle: string
  proposalBody: string | null
  visitDate: string   // ISO date string (slice à 10 chars si nécessaire)
  resolvedBy: string | null
  sourceKind?: 'field_visit' | 'meeting'  // déduit automatiquement si omis
}): Promise<void> {
  const { proposalId, siteId, canonicalSubjectId, reportId, proposalTitle, proposalBody, visitDate, resolvedBy } = params
  const supabase = createAdminClient()

  // Déduire sourceKind depuis origin si non fourni
  let sourceKind = params.sourceKind
  if (!sourceKind) {
    const { data: rr } = await supabase
      .from('site_reports')
      .select('origin')
      .eq('id', reportId)
      .maybeSingle()
    sourceKind = ((rr as { origin?: string | null } | null)?.origin != null) ? 'field_visit' : 'meeting'
  }

  await supabase
    .from('canonical_subject_occurrence')
    .upsert(
      {
        canonical_subject_id: canonicalSubjectId,
        site_id: siteId,
        source_kind: sourceKind,
        source_ref_id: reportId,
        source_proposal_id: proposalId,
        visit_status: sourceKind === 'field_visit' ? 'field_checked' : 'mentioned',
        label: proposalTitle,
        note: proposalBody,
        evidence_count: 0,
        effective_date: visitDate.slice(0, 10),
        created_by: resolvedBy,
      },
      { onConflict: 'source_kind,source_proposal_id', ignoreDuplicates: true },
    )

  await supabase
    .from('site_knowledge_proposals')
    .update({ canonical_subject_id: canonicalSubjectId, canonical_resolution_status: 'resolved' })
    .eq('id', proposalId)
}
