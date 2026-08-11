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

// ─── Invariant occurrence — Fact Ledger ──────────────────────────────────────

/**
 * Mappe le statut d'une proposition vers le validation_status de l'occurrence canonique.
 * Pure, exportée pour les tests.
 *
 * Règle :
 *   confirmed / fulfilled → confirmed (vérité terrain validée par l'humain)
 *   dismissed             → rejected  (le fait existait, l'humain l'a refusé)
 *   proposed / superseded → observed  (extrait et connu, pas encore validé)
 */
export function mapProposalStatusToValidation(
  status: string,
): 'observed' | 'confirmed' | 'rejected' {
  if (status === 'confirmed' || status === 'fulfilled') return 'confirmed'
  if (status === 'dismissed') return 'rejected'
  return 'observed' // proposed, superseded
}

/**
 * Garantit qu'une occurrence canonique existe pour une proposition déjà rattachée à un CS.
 *
 * Idempotent : ignoreDuplicates préserve une occurrence confirmed déjà présente.
 * Ne dégrade jamais confirmed → observed ni rejected → observed.
 *
 * À appeler après tout chemin qui attribue canonical_subject_id à une proposition.
 */
export async function ensureCanonicalSubjectOccurrence(params: {
  proposalId: string
  canonicalSubjectId: string
  siteId: string
  sourceKind: 'field_visit' | 'meeting'
  sourceRefId: string    // report_id de la proposition
  effectiveDate: string  // YYYY-MM-DD
  label: string
  note: string | null
  entityIds: string[]
  proposalStatus: string
  createdBy: string | null
}): Promise<void> {
  const supabase = createAdminClient()
  const validationStatus = mapProposalStatusToValidation(params.proposalStatus)

  await supabase.from('canonical_subject_occurrence').upsert(
    {
      canonical_subject_id: params.canonicalSubjectId,
      site_id: params.siteId,
      source_kind: params.sourceKind,
      source_ref_id: params.sourceRefId,
      source_proposal_id: params.proposalId,
      visit_status: params.sourceKind === 'field_visit' ? 'field_checked' : 'mentioned',
      label: params.label,
      note: params.note,
      evidence_count: 0,
      effective_date: params.effectiveDate,
      created_by: params.createdBy,
      validation_status: validationStatus,
      entity_ids: params.entityIds,
    },
    { onConflict: 'source_kind,source_proposal_id', ignoreDuplicates: true },
  )
}

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
  /** Identifiants des entités reconnues portées par cette proposition (mig 310).
   *  Snapshots : renseignés à la date de la source, jamais réécrits par un renommage. */
  entityIds?: string[]
}): Promise<ReconcileResult> {
  const { proposalId, siteId, reportId, proposalKind, proposalTitle, proposalBody, proposalCreatedAt, createdBy } = params
  const validationStatus = params.validationStatus ?? 'confirmed'
  const entityIds = params.entityIds ?? []

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
      entity_ids: entityIds,
    }

    // upsert idempotent : ignoreDuplicates:true préserve rejected, ne réécrit pas confirmed
    const { error: occErr } = await supabase
      .from('canonical_subject_occurrence')
      .upsert(occurrenceData, { onConflict: 'source_kind,source_proposal_id', ignoreDuplicates: true })
    if (occErr) {
      console.error('[reconcile] occurrence upsert failed:', proposalId, occErr.code, occErr.message)
    }

    if (validationStatus === 'confirmed') {
      // Upgrade explicite observed→confirmed (ne touche pas rejected — filtre validation_status)
      await supabase
        .from('canonical_subject_occurrence')
        .update({ validation_status: 'confirmed' })
        .eq('source_kind', sourceKind)
        .eq('source_proposal_id', proposalId)
        .eq('validation_status', 'observed')
    }

    const { error: propErr } = await supabase
      .from('site_knowledge_proposals')
      .update({ canonical_subject_id: canonicalSubjectId, canonical_resolution_status: 'resolved' })
      .eq('id', proposalId)
    if (propErr) {
      console.error('[reconcile] proposal update failed:', proposalId, propErr.code, propErr.message)
    }

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
  entityIds?: string[]
}): Promise<void> {
  const { proposalId, siteId, canonicalSubjectId, reportId, proposalTitle, proposalBody, visitDate, resolvedBy } = params
  const entityIds = params.entityIds ?? []
  const supabase = createAdminClient()

  const VISIT_ORIGINS = new Set(['planned', 'spontaneous', 'qr', 'gps', 'import'])

  // Déduire sourceKind depuis origin si non fourni
  let sourceKind = params.sourceKind
  if (!sourceKind) {
    const { data: rr } = await supabase
      .from('site_reports')
      .select('origin')
      .eq('id', reportId)
      .maybeSingle()
    const origin = (rr as { origin?: string | null } | null)?.origin ?? null
    sourceKind = (origin && VISIT_ORIGINS.has(origin)) ? 'field_visit' : 'meeting'
  }

  // ensureCanonicalSubjectOccurrence garantit l'invariant Fact Ledger :
  // proposal.canonical_subject_id != null ⇒ occurrence existe.
  // ignoreDuplicates préserve une occurrence confirmed déjà présente.
  await ensureCanonicalSubjectOccurrence({
    proposalId,
    canonicalSubjectId,
    siteId,
    sourceKind,
    sourceRefId: reportId,
    effectiveDate: visitDate.slice(0, 10),
    label: proposalTitle,
    note: proposalBody,
    entityIds,
    proposalStatus: 'confirmed', // résolution manuelle = action humaine
    createdBy: resolvedBy,
  })

  // Si l'occurrence existait déjà en observed, upgrade vers confirmed.
  await supabase
    .from('canonical_subject_occurrence')
    .update({ validation_status: 'confirmed', canonical_subject_id: canonicalSubjectId })
    .eq('source_kind', sourceKind)
    .eq('source_proposal_id', proposalId)
    .eq('validation_status', 'observed')

  await supabase
    .from('site_knowledge_proposals')
    .update({ canonical_subject_id: canonicalSubjectId, canonical_resolution_status: 'resolved' })
    .eq('id', proposalId)
}
