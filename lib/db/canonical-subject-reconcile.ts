import 'server-only'

// Pont synchrone : proposition terrain → occurrence canonique.
//
// Appelé en deux contextes (fire-and-forget dans les deux cas) :
//   1. À la création de la proposition (projectDebriefToProposals) → validationStatus='observed'
//   2. Après promoteProposal() → validationStatus='confirmed'
//
// Règle de priorité :
//   confirmed > observed : une promotion n'est jamais rétrogradée par un appel observed
//   rejected  → uniquement via dismissProposal() ; jamais écrasé automatiquement
//
// Résultats possibles :
//   resolved         → occurrence créée/mise à jour ; canonical_subject_id renseigné
//   needs_resolution → ambiguïté ; candidats stockés dans payload, état marqué
//   not_found        → aucun sujet connu ; état marqué ; aucune occurrence
//   skipped          → kind non éligible ou source hors terrain

import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCanonicalSubjectReference } from '@/lib/db/canonical-subject-resolve'

export const ELIGIBLE_KINDS = new Set(['action', 'vigilance', 'decision', 'knowledge', 'deadline'])

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
  validationStatus?: 'observed' | 'confirmed'  // défaut : 'confirmed' (compat V1)
}): Promise<ReconcileResult> {
  const { proposalId, siteId, reportId, proposalKind, proposalTitle, proposalBody, proposalCreatedAt, createdBy } = params
  const validationStatus = params.validationStatus ?? 'confirmed'

  if (!ELIGIBLE_KINDS.has(proposalKind)) return { status: 'skipped' }

  const supabase = createAdminClient()

  // Date effective + discriminant réunion/visite (mig 162 + 202).
  // VISIT_ORIGINS liste explicitement toutes les valeurs terrain connues.
  // Une valeur inconnue tombe dans 'meeting' par défaut (faux négatif < faux positif).
  // Invariant schéma : origin IS NULL ≡ réunion (garanti dans mig 162 et 202).
  const VISIT_ORIGINS = new Set(['planned', 'spontaneous', 'qr', 'gps', 'import'])

  const { data: reportRow } = await supabase
    .from('site_reports')
    .select('created_at, started_at, origin')
    .eq('id', reportId)
    .maybeSingle()
  type ReportRow = { created_at?: string; started_at?: string | null; origin?: string | null } | null
  const rr = reportRow as ReportRow
  const visitDate = (rr?.started_at ?? rr?.created_at ?? proposalCreatedAt).slice(0, 10)
  if (rr?.origin && !VISIT_ORIGINS.has(rr.origin)) {
    console.warn(`[reconcile] origin inconnue "${rr.origin}" pour report ${reportId} — classé comme "meeting" par défaut. Vérifier si VISIT_ORIGINS doit être étendu.`)
  }
  const sourceKind: 'field_visit' | 'meeting' = (rr?.origin && VISIT_ORIGINS.has(rr.origin)) ? 'field_visit' : 'meeting'

  // Résolution 3 passes (exact → code+Jaccard → Jaccard)
  const resolution = await resolveCanonicalSubjectReference(siteId, proposalTitle)

  if (resolution.kind === 'resolved') {
    const canonicalSubjectId = resolution.candidate.id

    const occurrenceData = {
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
      validation_status: validationStatus,
    }

    if (validationStatus === 'observed') {
      // observed n'écrase jamais confirmed ni rejected — ignoreDuplicates préserve l'existant
      await supabase
        .from('canonical_subject_occurrence')
        .upsert(occurrenceData, { onConflict: 'source_kind,source_proposal_id', ignoreDuplicates: true })
    } else {
      // confirmed : INSERT puis upgrade de observed→confirmed si conflit
      // (ne touche pas rejected — rejected ne bouge que sur action humaine explicite)
      const { error: insertErr } = await supabase
        .from('canonical_subject_occurrence')
        .insert(occurrenceData)
      if (insertErr?.code === '23505') {
        await supabase
          .from('canonical_subject_occurrence')
          .update({ validation_status: 'confirmed' })
          .eq('source_kind', sourceKind)
          .eq('source_proposal_id', proposalId)
          .eq('validation_status', 'observed')
      }
    }

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

    // Pour les nouvelles propositions terrain avec peu de candidats : tenter
    // une levée d'ambiguïté LLM → canonical_subject_suggestion pending.
    // Fire-and-forget — n'attend jamais, ne bloque jamais la réconciliation principale.
    if (validationStatus === 'observed' && resolution.candidates.length <= 3) {
      void (async () => {
        try {
          const { createVisitAmbiguitySuggestion } = await import('@/lib/documents/visit-proposal-suggestion')
          await createVisitAmbiguitySuggestion({
            proposalId,
            proposalKind,
            siteId,
            proposalTitle,
            proposalBody,
            candidates: resolution.candidates,
          })
        } catch { /* non bloquant */ }
      })()
    }

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
    const VISIT_ORIGINS = new Set(['planned', 'spontaneous', 'qr', 'gps', 'import'])
    const origin = (rr as { origin?: string | null } | null)?.origin ?? null
    sourceKind = (origin && VISIT_ORIGINS.has(origin)) ? 'field_visit' : 'meeting'
  }

  // Résolution manuelle = action humaine → confirmed.
  // Même logique que reconcileProposalToCanonical avec validationStatus='confirmed' :
  // upgrade de observed→confirmed, mais ne touche pas rejected.
  const { error: insertErr } = await supabase
    .from('canonical_subject_occurrence')
    .insert({
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
      validation_status: 'confirmed',
    })
  if (insertErr?.code === '23505') {
    await supabase
      .from('canonical_subject_occurrence')
      .update({ validation_status: 'confirmed', canonical_subject_id: canonicalSubjectId })
      .eq('source_kind', sourceKind)
      .eq('source_proposal_id', proposalId)
      .eq('validation_status', 'observed')
  }

  await supabase
    .from('site_knowledge_proposals')
    .update({ canonical_subject_id: canonicalSubjectId, canonical_resolution_status: 'resolved' })
    .eq('id', proposalId)
}
