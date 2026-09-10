import 'server-only'

// P6 — raccordement du rail V2 d'identité Point. Porte la logique de scripts/_p5b6-v1v2-engine.ts
// (dry-run, jamais branchée en production) au-dessus du moteur gelé Phase 4
// (tracked-point-membership-candidates.ts), SANS modifier ce dernier ni le moteur canonical_subject.
//
// Chaîne cible (mandat Vincent) : déterministe d'abord (moteur étroit Phase 4, rails
// cbo/exact/strong_containment/bounded_cross_subject) → si DISTINCT_POINT hors voisinage strict,
// élargir le voisinage (ancres/signatures) → comparaison de signature déterministe (SAME/DISTINCT
// tranchés, sinon AMBIGUOUS) → juge LLM Q1/Q2 uniquement pour l'AMBIGUOUS → UNCERTAIN si le juge
// décline ou reste dans le doute. Jamais de fusion silencieuse : SAME_POINT n'est atteint que par
// un rail fort du moteur étroit, un seuil de Jaccard explicite, ou un verdict explicite du juge.
//
// `resolveWidenedNeighborhood` est porté verbatim depuis scripts/_p5b6-v1v2-engine.ts (label du
// Point/de ses membres, exact ou containment fort, indépendamment de la relation de sujet).

import {
  resolveNeighborhoodRule,
  evaluateMembershipCandidate,
  type CandidateThreadInput,
  type TrackedPointCandidate,
  type MembershipDecision,
  type MembershipRail,
  type MembershipNeighborhoodRule,
  type MembershipCandidateResult,
} from '@/lib/knowledge/tracked-point-membership-candidates'
import { normalizeLabel, stripCategoryFormatting, strongContainmentMatch, GENERIC_TOKENS } from '@/lib/documents/subject-reconciliation'
import { deriveConditionSignature, compareSignatures, tokenSet, type ConditionSignature } from '@/lib/knowledge/tracked-point-condition-signature'

export type WidenedNeighborhoodRule = MembershipNeighborhoodRule | 'widened_label_match'

/** Porté verbatim depuis scripts/_p5b6-v1v2-engine.ts (angle mort Gate 1, item 8/11 sousfusion25). */
export function resolveWidenedNeighborhood(
  candidate: CandidateThreadInput,
  point: TrackedPointCandidate,
): WidenedNeighborhoodRule | null {
  const base = resolveNeighborhoodRule(candidate, point)
  if (base) return base
  const memberLabels = [point.label, ...point.memberLabels]
  const candidateNorm = normalizeLabel(stripCategoryFormatting(candidate.label))
  const exactHit = candidateNorm.length > 0 && memberLabels.some((l) => normalizeLabel(stripCategoryFormatting(l)) === candidateNorm)
  if (exactHit) return 'widened_label_match'
  const containmentHit = memberLabels.some((l) => strongContainmentMatch(candidate.label, l))
  if (containmentHit) return 'widened_label_match'
  return null
}

export type IdentityNeighborhoodRule = WidenedNeighborhoodRule | 'signature_anchor_match'

// Identifiant de type "r7" / "pt00392" : toujours discriminant, quelle que soit sa longueur —
// un code de site/équipement n'est jamais générique même court.
const IDENTIFIER_TOKEN_RE = /^[a-z]+[0-9]+$/

/**
 * Un token d'ancre partagé ne justifie d'élargir le voisinage que s'il est réellement
 * discriminant — sinon un seul mot générique commun (ex. "cta", présent dans deux labels qui
 * ne parlent que du même TYPE d'équipement, jamais de la même occurrence) suffirait à faire
 * entrer un témoin confidemment DISTINCT dans le pool ambigu (garde anti-overmerge du mandat).
 * Même seuil de longueur que `strongContainmentMatch` (1 token significatif ≥ 7 chars), avec
 * une exception pour les identifiants alphanumériques (r7, pt00392) qui restent discriminants
 * même courts.
 */
function isSignificantAnchorToken(token: string): boolean {
  if (IDENTIFIER_TOKEN_RE.test(token)) return true
  return token.length >= 7 && !GENERIC_TOKENS.has(token)
}

/**
 * Élargit encore le voisinage au-delà du lexical : si `resolveWidenedNeighborhood` ne trouve
 * rien, un chevauchement d'ancre de signature suffit à faire ENTRER le candidat dans le pool —
 * jamais à décider seul (la décision reste au rail déterministe de signature ou au juge, plus
 * bas) — À CONDITION que le token partagé soit significatif (cf. isSignificantAnchorToken).
 */
export function resolveIdentityNeighborhood(
  candidate: CandidateThreadInput,
  point: TrackedPointCandidate,
  candidateSig: ConditionSignature,
  pointSig: ConditionSignature,
): IdentityNeighborhoodRule | null {
  const widened = resolveWidenedNeighborhood(candidate, point)
  if (widened) return widened
  const sharedAnchorTokens = [...tokenSet(candidateSig.anchor)].filter((t) => tokenSet(pointSig.anchor).has(t))
  if (sharedAnchorTokens.some(isSignificantAnchorToken)) return 'signature_anchor_match'
  return null
}

/**
 * Juge borné Q1/Q2, injectable — implémentation réelle dans lib/ai/tracked-point-identity-judge.ts.
 * Retourne `null` pour signifier qu'il décline (→ UNCERTAIN, jamais un défaut SAME/DISTINCT).
 */
export type IdentityJudge = (
  candidate: CandidateThreadInput,
  point: TrackedPointCandidate,
  candidateSig: ConditionSignature,
  pointSig: ConditionSignature,
) => Promise<{ decision: MembershipDecision; reasoning: string } | null>

export type WidenedMembershipRail = MembershipRail | 'signature' | 'llm_identity'

export type WidenedMembershipCandidateResult = Omit<MembershipCandidateResult, 'rail'> & {
  rail: WidenedMembershipRail
  neighborhoodRule: IdentityNeighborhoodRule | null
}

/**
 * Orchestrateur V2. Ordre :
 *   1. Moteur étroit Phase 4 (`evaluateMembershipCandidate`, inchangé) — retour immédiat si
 *      SAME_POINT (rail fort déjà tranché, rien à élargir).
 *   2. Si le moteur étroit ne trouve même pas de voisinage élargi (`resolveIdentityNeighborhood`
 *      null) : le résultat étroit (DISTINCT_POINT) est renvoyé tel quel — hors périmètre V2.
 *   3. Comparaison de signature déterministe : DISTINCT/SAME tranchés (seuils Jaccard explicites,
 *      rail 'signature') ; AMBIGUOUS → juge si fourni (rail 'llm_identity'), sinon UNCERTAIN
 *      (rail 'signature', jamais un défaut SAME ou DISTINCT silencieux).
 */
export async function evaluateWidenedMembershipCandidate(
  candidate: CandidateThreadInput,
  point: TrackedPointCandidate,
  opts: { identityJudge?: IdentityJudge } = {},
): Promise<WidenedMembershipCandidateResult> {
  const narrow = evaluateMembershipCandidate(candidate, point)
  if (narrow.decision === 'SAME_POINT') {
    return { ...narrow, neighborhoodRule: resolveNeighborhoodRule(candidate, point) }
  }

  const candidateSig = deriveConditionSignature(candidate.label)
  const pointSig = deriveConditionSignature(point.label)
  const neighborhoodRule = resolveIdentityNeighborhood(candidate, point, candidateSig, pointSig)
  if (!neighborhoodRule) {
    return { ...narrow, neighborhoodRule: null }
  }

  const sigComparison = compareSignatures(candidateSig, pointSig)
  const base = { candidateThread: candidate.threadId, candidatePoint: point.pointId, neighborhoodRule }

  if (sigComparison.deterministic === 'DISTINCT') {
    return {
      ...base,
      decision: 'DISTINCT_POINT',
      rail: 'signature',
      evidence: {
        ...narrow.evidence,
        reasoning: `Signature élargie sans ancre commune (anchorOverlap=${sigComparison.anchorOverlap.toFixed(2)}) — anti-fusion.`,
      },
    }
  }
  if (sigComparison.deterministic === 'SAME') {
    return {
      ...base,
      decision: 'SAME_POINT',
      rail: 'signature',
      evidence: {
        ...narrow.evidence,
        reasoning: `Signature élargie : ancre et condition suivie fortement recouvrantes (anchorOverlap=${sigComparison.anchorOverlap.toFixed(2)}, conditionOverlap=${sigComparison.conditionOverlap.toFixed(2)}).`,
      },
    }
  }

  if (opts.identityJudge) {
    const verdict = await opts.identityJudge(candidate, point, candidateSig, pointSig)
    if (verdict) {
      return {
        ...base,
        decision: verdict.decision,
        rail: 'llm_identity',
        evidence: { ...narrow.evidence, reasoning: verdict.reasoning },
      }
    }
  }

  return {
    ...base,
    decision: 'UNCERTAIN',
    rail: 'signature',
    evidence: {
      ...narrow.evidence,
      reasoning: `Ambiguïté réelle non tranchée (anchorOverlap=${sigComparison.anchorOverlap.toFixed(2)}, conditionOverlap=${sigComparison.conditionOverlap.toFixed(2)}) — pas de fusion par défaut, candidat d'identité à examiner.`,
    },
  }
}
