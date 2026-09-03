import 'server-only'

// P1-4B1 — persistance des résolutions du pont documentaire de complétion (migration 380).
//
// Le documentaire est une INFÉRENCE RÉVISABLE : ce module N'ÉCRIT JAMAIS dans
// object_state_occurrence_signal (réservé aux faits événementiels : import + natif P1-4A). Il
// persiste seulement des résolutions APPEND-ONLY (preuve → décision versionnée). Il NE consomme
// PAS encore ces résolutions (loadCboEvolutions inchangé — c'est P1-4B2).
//
// Décision effective : DÉRIVÉE, jamais un flag mutable. La résolution courante d'une preuve est
// celle qui correspond à la politique ACTIVE et au contexte COURANT (empreinte des candidats
// actuels). L'index UNIQUE (proof, policy, fingerprint) garantit qu'il n'y en a jamais deux.

import { createHash } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'

/** Version de la politique de résolution documentaire en vigueur (calibration V2, gate passé RUS). */
export const COMPLETION_POLICY_VERSION = 'p1.4b.v2'

export type CompletionDecision = 'MATCH' | 'AMBIGUOUS' | 'NO_MATCH'
export type ConfidenceClass = 'HIGH' | 'MEDIUM' | 'LOW'
export type CandidateVerdict = 'accomplished' | 'not_accomplished' | 'uncertain'
export type IntentMatch = 'exact' | 'related' | 'different'

/**
 * Empreinte CANONIQUE et DÉTERMINISTE de l'ensemble des CBO candidats évalués.
 * Triée + dédupliquée : deux ensembles logiquement identiques dans un ordre SQL différent
 * produisent la MÊME empreinte. Change quand le SET de candidats change (topologie CBO), pas
 * pour un ordre technique. C'est la clé de la réévaluation après import rétroactif.
 */
export function computeContextFingerprint(candidateCboIds: string[]): string {
  const canonical = [...new Set(candidateCboIds)].sort().join(',')
  return createHash('sha256').update(canonical).digest('hex')
}

/**
 * Empreinte de contexte ENRICHIE (P1-4B-PROPOSAL) — lie TOUT le contenu décisionnel réellement
 * présenté au resolver, pas seulement les IDs candidats : contenu de la preuve (proposition) ET,
 * pour chaque candidat, son ID **et son libellé** (un CBO dont le libellé change sans changer d'ID
 * change le jugement possible). Ordre-invariante sur les candidats, normalisée.
 *
 * L'IDENTITÉ de la preuve est portée par proof_proposal_id (hors hash). `stable_key` N'ENTRE PAS
 * dans le fingerprint : c'est un identifiant intra-document, pas du contenu décisionnel.
 */
export function computeProofContextFingerprint(
  proof: { label: string; description?: string | null; sourceExcerpt?: string | null; documentStatus?: string | null; effectiveDate?: string | null },
  candidates: { cboId: string; label: string }[],
): string {
  const norm = (s: string | null | undefined) => (s ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
  const proofPart = [norm(proof.label), norm(proof.description), norm(proof.sourceExcerpt), norm(proof.documentStatus), norm(proof.effectiveDate)].join('␟')
  const candPart = [...candidates].map((c) => `${c.cboId}␝${norm(c.label)}`).sort().join('␞')
  return createHash('sha256').update(`${proofPart}‖${candPart}`).digest('hex')
}

/** V2.2 (mig 381) : la preuve démontre-t-elle DIRECTEMENT le résultat, ou faut-il une inférence ? */
export type EvidenceDirectness = 'direct' | 'inferred'

export type CompletionCandidateInput = {
  canonicalBusinessObjectId: string
  verdict: CandidateVerdict
  intentMatch: IntentMatch
  /** Nullable : les candidats V2/V2.1 antérieurs n'ont jamais produit cette dimension. */
  evidenceDirectness?: EvidenceDirectness | null
  reason?: string | null
}

export type PersistResolutionInput = {
  siteId: string
  /** Preuve LEGACY occurrence-level. XOR avec proofProposalId : exactement une des deux. */
  proofOccurrenceId?: string | null
  /** Preuve ATOMIQUE proposition-level (P1-4B-PROPOSAL). XOR avec proofOccurrenceId. */
  proofProposalId?: string | null
  candidates: CompletionCandidateInput[]
  decision: CompletionDecision
  confidenceClass: ConfidenceClass
  /** Renseigné SI ET SEULEMENT SI decision=MATCH (contrainte DB dcr_selected_only_if_match). */
  selectedCboId: string | null
  reasoning?: string | null
  policyVersion?: string
  resolverSource?: 'llm' | 'deterministic' | 'manual'
  model?: string | null
  modelVersion?: string | null
  /** Empreinte enrichie précalculée (proposition-level). Si absente → legacy (IDs candidats seuls). */
  contextFingerprint?: string
}

export type PersistResolutionOutcome =
  | { kind: 'created'; resolutionId: string; contextFingerprint: string }
  | { kind: 'already_exists'; resolutionId: string; contextFingerprint: string }

/**
 * Persiste une résolution APPEND-ONLY, idempotente par (proof, policy_version, context_fingerprint).
 * Retry/replay du même pipeline → no-op (renvoie l'existante). Une nouvelle politique OU un nouveau
 * contexte (topologie CBO modifiée) produit une NOUVELLE ligne, l'ancienne restant conservée (audit).
 */
export async function persistCompletionResolution(input: PersistResolutionInput): Promise<PersistResolutionOutcome> {
  const sb = createAdminClient()
  const policyVersion = input.policyVersion ?? COMPLETION_POLICY_VERSION
  // XOR : exactement une référence de preuve (occurrence legacy OU proposition atomique).
  const hasOcc = input.proofOccurrenceId != null
  const hasProp = input.proofProposalId != null
  if (hasOcc === hasProp) throw new Error('persistCompletionResolution: exactement une preuve requise (proofOccurrenceId XOR proofProposalId)')
  const contextFingerprint = input.contextFingerprint ?? computeContextFingerprint(input.candidates.map((c) => c.canonicalBusinessObjectId))

  // Persistance ATOMIQUE (migration 382) : parent + candidats dans une seule transaction plpgsql.
  // Un échec candidat (CHECK/FK) provoque le rollback INTÉGRAL — jamais de résolution effective
  // partielle, retry toujours sûr. Le fingerprint reste calculé ici (sha256) et passé à la RPC ;
  // la RPC ne change ni la policy, ni la décision, ni l'identité (proof, policy, fingerprint).
  const { data, error } = await sb.rpc('persist_document_completion_resolution', {
    p_site_id: input.siteId,
    p_proof_occurrence_id: input.proofOccurrenceId ?? null,
    p_proof_proposal_id: input.proofProposalId ?? null,
    p_policy_version: policyVersion,
    p_context_fingerprint: contextFingerprint,
    p_decision: input.decision,
    p_confidence_class: input.confidenceClass,
    p_selected_cbo_id: input.selectedCboId,
    p_reasoning: input.reasoning ?? null,
    p_resolver_source: input.resolverSource ?? 'llm',
    p_model: input.model ?? null,
    p_model_version: input.modelVersion ?? null,
    p_candidates: input.candidates.map((c) => ({
      canonicalBusinessObjectId: c.canonicalBusinessObjectId,
      verdict: c.verdict,
      intentMatch: c.intentMatch,
      evidenceDirectness: c.evidenceDirectness ?? null,
      reason: c.reason ?? null,
    })),
  })
  if (error) throw new Error(`persistCompletionResolution: RPC atomique échouée — ${error.message}`)
  const row = (Array.isArray(data) ? data[0] : data) as { kind: string; resolution_id: string } | undefined
  if (!row?.resolution_id) throw new Error('persistCompletionResolution: RPC sans résultat exploitable')
  const kind = row.kind === 'already_exists' ? 'already_exists' : 'created'
  return { kind, resolutionId: row.resolution_id, contextFingerprint }
}

export type EffectiveResolution = {
  id: string
  decision: CompletionDecision
  confidenceClass: ConfidenceClass
  selectedCboId: string | null
  policyVersion: string
  contextFingerprint: string
  resolvedAt: string
}

/**
 * DÉCISION EFFECTIVE dérivée (pas de flag is_effective). Renvoie la résolution qui correspond à la
 * politique active et au contexte courant, ou null si aucune (la preuve doit alors être re-résolue —
 * les résolutions antérieures, sous une autre topologie/politique, restent conservées pour l'audit).
 */
export async function getEffectiveResolution(
  proofOccurrenceId: string,
  currentCandidateCboIds: string[],
  policyVersion: string = COMPLETION_POLICY_VERSION,
): Promise<EffectiveResolution | null> {
  const sb = createAdminClient()
  const contextFingerprint = computeContextFingerprint(currentCandidateCboIds)
  const { data } = await sb
    .from('document_completion_resolution')
    .select('id, decision, confidence_class, selected_cbo_id, policy_version, context_fingerprint, resolved_at')
    .eq('proof_occurrence_id', proofOccurrenceId)
    .eq('policy_version', policyVersion)
    .eq('context_fingerprint', contextFingerprint)
    .maybeSingle()
  if (!data) return null
  const r = data as { id: string; decision: string; confidence_class: string; selected_cbo_id: string | null; policy_version: string; context_fingerprint: string; resolved_at: string }
  return {
    id: r.id, decision: r.decision as CompletionDecision, confidenceClass: r.confidence_class as ConfidenceClass,
    selectedCboId: r.selected_cbo_id, policyVersion: r.policy_version, contextFingerprint: r.context_fingerprint, resolvedAt: r.resolved_at,
  }
}

/**
 * Décision effective proposition-level (P1-4B-PROPOSAL). Identique en esprit à getEffectiveResolution
 * mais adressée par proof_proposal_id + empreinte enrichie précalculée (le contexte de décision est le
 * contenu de la proposition, pas seulement les IDs candidats).
 */
export async function getEffectiveResolutionByProposal(
  proofProposalId: string,
  contextFingerprint: string,
  policyVersion: string = COMPLETION_POLICY_VERSION,
): Promise<EffectiveResolution | null> {
  const sb = createAdminClient()
  const { data } = await sb
    .from('document_completion_resolution')
    .select('id, decision, confidence_class, selected_cbo_id, policy_version, context_fingerprint, resolved_at')
    .eq('proof_proposal_id', proofProposalId)
    .eq('policy_version', policyVersion)
    .eq('context_fingerprint', contextFingerprint)
    .maybeSingle()
  if (!data) return null
  const r = data as { id: string; decision: string; confidence_class: string; selected_cbo_id: string | null; policy_version: string; context_fingerprint: string; resolved_at: string }
  return {
    id: r.id, decision: r.decision as CompletionDecision, confidenceClass: r.confidence_class as ConfidenceClass,
    selectedCboId: r.selected_cbo_id, policyVersion: r.policy_version, contextFingerprint: r.context_fingerprint, resolvedAt: r.resolved_at,
  }
}
