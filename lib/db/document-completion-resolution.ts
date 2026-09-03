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
  proofOccurrenceId: string
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
  const contextFingerprint = computeContextFingerprint(input.candidates.map((c) => c.canonicalBusinessObjectId))

  const { data: existing } = await sb
    .from('document_completion_resolution')
    .select('id')
    .eq('proof_occurrence_id', input.proofOccurrenceId)
    .eq('policy_version', policyVersion)
    .eq('context_fingerprint', contextFingerprint)
    .maybeSingle()
  if (existing) return { kind: 'already_exists', resolutionId: (existing as { id: string }).id, contextFingerprint }

  const { data: res, error } = await sb
    .from('document_completion_resolution')
    .insert({
      site_id: input.siteId,
      proof_occurrence_id: input.proofOccurrenceId,
      policy_version: policyVersion,
      context_fingerprint: contextFingerprint,
      decision: input.decision,
      confidence_class: input.confidenceClass,
      selected_cbo_id: input.selectedCboId,
      reasoning: input.reasoning ?? null,
      resolver_source: input.resolverSource ?? 'llm',
      model: input.model ?? null,
      model_version: input.modelVersion ?? null,
    })
    .select('id')
    .single()
  if (error || !res) throw new Error(`persistCompletionResolution: insert résolution échoué — ${error?.message}`)
  const resolutionId = (res as { id: string }).id

  if (input.candidates.length > 0) {
    const { error: cErr } = await sb.from('document_completion_candidate').insert(
      input.candidates.map((c) => ({
        resolution_id: resolutionId,
        canonical_business_object_id: c.canonicalBusinessObjectId,
        candidate_verdict: c.verdict,
        intent_match: c.intentMatch,
        evidence_directness: c.evidenceDirectness ?? null,
        reason: c.reason ?? null,
      })),
    )
    if (cErr) throw new Error(`persistCompletionResolution: insert candidats échoué — ${cErr.message}`)
  }
  return { kind: 'created', resolutionId, contextFingerprint }
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
