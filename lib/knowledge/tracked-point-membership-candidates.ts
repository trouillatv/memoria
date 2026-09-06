import 'server-only'

// Phase 4 (programme Point de suivi) — moteur de membership READ-ONLY. Contrat
// P0-1H-GATES-POINT-DE-SUIVI.md § Gate 1 (voisinage de candidature + prédicat décisif),
// § SORTIE point 6 (étalons F8/RIA/CTA). N'ÉCRIT RIEN : produit des candidats à examiner,
// jamais une adhésion matérialisée (réservé Phase 5, sur GO explicite).
//
// Principe directeur (Vincent, clôture Phase 3) : le canonical_subject sert à TROUVER des
// candidats (voisinage), jamais à DÉCIDER de l'identité — c'est la co-résolution
// (containment fort déterministe, sinon juge borné) qui tranche. Le moteur ne doit
// jamais transformer une proximité de sujet en fusion automatique.
//
// Prédicat décisif réutilisé tel quel (architecture gelée, ne pas dupliquer) :
// `strongContainmentMatch` de lib/documents/subject-reconciliation.ts. Contrairement à
// `computeBestCandidate` (réconciliation de threads), AUCUNE frontière `proposal_family`
// n'est appliquée ici : F8 échoue précisément sur cette frontière dans l'ancien moteur, et
// le Point est le premier consommateur cross-famille du containment fort.
//
// Défaut de sécurité : en l'absence de CBO partagé, de match exact ou de containment fort,
// le moteur ne fusionne JAMAIS silencieusement (DISTINCT_POINT par défaut — anti-fusion /
// anti-sur-fusion). Le rail `llm` n'est invoqué que si l'appelant fournit un juge borné
// (`opts.llmJudge`) ; Phase 4 ne câble aucun appel LLM réel — c'est un point d'extension
// typé pour un lot ultérieur, pas un comportement inventé.

import { normalizeLabel, stripCategoryFormatting, strongContainmentMatch } from '@/lib/documents/subject-reconciliation'

export type MembershipDecision = 'SAME_POINT' | 'DISTINCT_POINT' | 'UNCERTAIN'
export type MembershipRail = 'cbo' | 'exact' | 'strong_containment' | 'bounded_cross_subject' | 'llm'
export type MembershipNeighborhoodRule = 'same_subject' | 'orphan' | 'related_subject'

export type CandidateThreadInput = {
  threadId: string
  /** Label représentatif du thread (dernière proposition, ou libellé le plus informatif). */
  label: string
  subjectId: string | null
  subjectLabel: string | null
  cboId?: string | null
  runId?: string | null
}

export type TrackedPointCandidate = {
  pointId: string
  /** Label curaté du Point (tracked_point.label) — comparaison primaire, pas la phrase brute. */
  label: string
  ownerSubjectId: string | null
  ownerSubjectLabel: string | null
  /** Labels des membres actifs, comparaison secondaire (best-match, comme computeBestCandidate). */
  memberLabels: string[]
  memberCboIds?: string[]
  memberRunIds?: string[]
}

export type MembershipEvidence = {
  sharedDiscriminantTokens: string[]
  subjectRelation: MembershipNeighborhoodRule | 'unrelated'
  sourceProximity: 'same_run' | 'different_run' | 'unknown'
  cboRelation: boolean
  /** Rationale de co-résolution (ex. mêmes bornes temporelles) — Phase 4 ne la calcule pas encore. */
  coResolutionRationale: string | null
  subjectMismatch: boolean
  /** Pool borné soumis au juge LLM, uniquement si le rail 'llm' a été emprunté. */
  boundedCandidates: string[] | null
  reasoning: string
}

export type MembershipCandidateResult = {
  candidateThread: string
  candidatePoint: string
  decision: MembershipDecision
  rail: MembershipRail
  evidence: MembershipEvidence
}

/**
 * Juge de co-résolution borné, injectable. Reçoit le candidat, le Point, et le pool de
 * labels borné qui lui est présenté (jamais tout le corpus). Retourne `null` pour signifier
 * qu'il décline (→ le moteur retombe sur son défaut anti-fusion DISTINCT_POINT).
 * Aucune implémentation réelle câblée en Phase 4 : point d'extension pour un lot ultérieur.
 */
export type LlmMembershipJudge = (
  candidate: CandidateThreadInput,
  point: TrackedPointCandidate,
  boundedPool: string[],
) => { decision: MembershipDecision; reasoning: string } | null

/**
 * Gate 1 — voisinage de candidature (3 règles, jamais un matching cross-sujet libre) :
 * 1. même sujet que le Point ;
 * 2. orphelin (aucune subject_thread_identity) ;
 * 3. sujet apparenté : le label du sujet candidat et celui du sujet du Point passent le
 *    containment fort sur tokens discriminants.
 * Retourne `null` si le thread n'a pas le droit d'être évalué pour ce Point.
 */
export function resolveNeighborhoodRule(
  candidate: CandidateThreadInput,
  point: TrackedPointCandidate,
): MembershipNeighborhoodRule | null {
  if (candidate.subjectId !== null && candidate.subjectId === point.ownerSubjectId) {
    return 'same_subject'
  }
  if (candidate.subjectId === null) {
    return 'orphan'
  }
  if (
    point.ownerSubjectLabel &&
    candidate.subjectLabel &&
    strongContainmentMatch(candidate.subjectLabel, point.ownerSubjectLabel)
  ) {
    return 'related_subject'
  }
  return null
}

function sharedTokens(a: string, b: string): string[] {
  const ta = new Set(normalizeLabel(a).split(' ').filter(Boolean))
  const tb = new Set(normalizeLabel(b).split(' ').filter(Boolean))
  return [...ta].filter((t) => tb.has(t)).sort()
}

function sourceProximity(candidate: CandidateThreadInput, point: TrackedPointCandidate): MembershipEvidence['sourceProximity'] {
  if (!candidate.runId || !point.memberRunIds?.length) return 'unknown'
  return point.memberRunIds.includes(candidate.runId) ? 'same_run' : 'different_run'
}

function buildEvidence(args: {
  candidate: CandidateThreadInput
  point: TrackedPointCandidate
  rule: MembershipNeighborhoodRule | null
  cboRelation?: boolean
  reasoning: string
  boundedCandidates?: string[] | null
}): MembershipEvidence {
  const { candidate, point, rule, cboRelation = false, reasoning, boundedCandidates = null } = args
  return {
    sharedDiscriminantTokens: sharedTokens(candidate.label, point.label),
    subjectRelation: rule ?? 'unrelated',
    sourceProximity: sourceProximity(candidate, point),
    cboRelation,
    coResolutionRationale: null,
    subjectMismatch: rule === 'related_subject',
    boundedCandidates,
    reasoning,
  }
}

/**
 * Évalue si `candidate` doit rejoindre `point`. Pur, synchrone (sauf juge LLM injecté), ne
 * lit ni n'écrit rien : les entrées sont déjà chargées par l'appelant (Phase 5 dry-run).
 *
 * Ordre des rails, du plus fort au plus faible :
 *   1. cbo — CBO membre déjà partagé (identité déjà arbitrée, indépendant du voisinage).
 *   2. exact — label identique après normalisation/strip.
 *   3. strong_containment / bounded_cross_subject — containment fort déterministe
 *      (`strongContainmentMatch`, prédicat gelé, réutilisé tel quel) contre le label
 *      curaté du Point ou l'un de ses membres actifs.
 *   4. llm — uniquement si `opts.llmJudge` est fourni et que rien de déterministe n'a tranché.
 *   5. défaut — DISTINCT_POINT (anti-fusion : aucune fusion sans preuve positive).
 */
export function evaluateMembershipCandidate(
  candidate: CandidateThreadInput,
  point: TrackedPointCandidate,
  opts: { llmJudge?: LlmMembershipJudge } = {},
): MembershipCandidateResult {
  const base = { candidateThread: candidate.threadId, candidatePoint: point.pointId }

  if (candidate.cboId && point.memberCboIds?.includes(candidate.cboId)) {
    return {
      ...base,
      decision: 'SAME_POINT',
      rail: 'cbo',
      evidence: buildEvidence({
        candidate,
        point,
        rule: resolveNeighborhoodRule(candidate, point),
        cboRelation: true,
        reasoning: 'CBO membre partagé — identité déjà arbitrée au niveau canonical_business_object.',
      }),
    }
  }

  const rule = resolveNeighborhoodRule(candidate, point)
  if (!rule) {
    return {
      ...base,
      decision: 'DISTINCT_POINT',
      rail: 'strong_containment',
      evidence: buildEvidence({
        candidate,
        point,
        rule: null,
        reasoning: 'Hors voisinage de candidature (Gate 1) — aucun sujet commun, orphelin, ou sujet apparenté par containment.',
      }),
    }
  }

  const memberLabels = [point.label, ...point.memberLabels]
  const candidateNorm = normalizeLabel(stripCategoryFormatting(candidate.label))

  const exactHit = candidateNorm.length > 0 && memberLabels.some((l) => normalizeLabel(stripCategoryFormatting(l)) === candidateNorm)
  if (exactHit) {
    return {
      ...base,
      decision: 'SAME_POINT',
      rail: 'exact',
      evidence: buildEvidence({ candidate, point, rule, reasoning: 'Label identique après normalisation/strip.' }),
    }
  }

  const containmentHit = memberLabels.some((l) => strongContainmentMatch(candidate.label, l))
  if (containmentHit) {
    return {
      ...base,
      decision: 'SAME_POINT',
      rail: rule === 'related_subject' ? 'bounded_cross_subject' : 'strong_containment',
      evidence: buildEvidence({
        candidate,
        point,
        rule,
        reasoning: 'Containment fort déterministe sur les tokens discriminants (label du Point ou d\'un membre actif).',
      }),
    }
  }

  if (opts.llmJudge) {
    const verdict = opts.llmJudge(candidate, point, memberLabels)
    if (verdict) {
      return {
        ...base,
        decision: verdict.decision,
        rail: 'llm',
        evidence: buildEvidence({ candidate, point, rule, reasoning: verdict.reasoning, boundedCandidates: memberLabels }),
      }
    }
  }

  return {
    ...base,
    decision: 'DISTINCT_POINT',
    rail: rule === 'related_subject' ? 'bounded_cross_subject' : 'strong_containment',
    evidence: buildEvidence({
      candidate,
      point,
      rule,
      reasoning: 'Aucun CBO partagé, aucun containment fort — anti-fusion par défaut, pas de preuve de co-résolution.',
    }),
  }
}
