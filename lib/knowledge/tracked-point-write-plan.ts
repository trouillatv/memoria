// P6 Live Writer — Phase 3 (partie pure) : plan d'écriture pour UNE FoundingUnit.
//
// Portage fidèle des types PlannedPoint/PlannedMember/PlannedPendingTrace et de la logique
// memberOf/upstreamDefectOf/classifyRootCause de scripts/_p6d1a-preflight-global.ts (lignes
// 360-412), lui-même copie fidèle de scripts/_p6c-preflight-rus.ts (frozen).
//
// Différence assumée avec le batch offline : le batch construit un plan pour TOUT le site en
// une passe (Map cboId→PlannedPoint agrégeant plusieurs threads, scan de candidats cross-thread
// via le moteur Phase 4 lib/knowledge/tracked-point-membership-candidates.ts). Le Live Writer
// traite UNE FoundingUnit à la fois, provenance-blind (un seul thread/proposal_set par appel) —
// il n'y a donc rien à agréger ici. « Existe-t-il déjà un Point pour cette identité de
// fondation ? » et « ce thread a-t-il un Point sibling actif ? » sont des questions d'état LIVE
// (verrouillé sous transaction, §2.5/§2.8 du design), pas des questions que cette primitive pure
// peut trancher — elle produit seulement CE QUE ce unit écrirait s'il fondait un Point,
// laissant la revalidation live (RPC SQL) décider CREATE vs ATTACH vs ENRICH vs NEEDS_HUMAN.
//
// Frozen — voir docs/tracked-points/p6-live-writer-design.md §2.1, §2.2, §2.4, §7.

import type { FoundingUnit, PropRow } from './tracked-point-founding'
import {
  evaluateMembershipCandidate,
  type CandidateThreadInput,
  type TrackedPointCandidate,
} from './tracked-point-membership-candidates'

// ── classifyRootCause — copie fidèle (frozen, ne pas modifier). ────────────────────────────

export type RootCause = 'SHOULD_HAVE_CBO_BUT_MISSING' | 'DOCUMENTARY_ACTION_NOT_PROMOTED' | 'NON_OPERATIONAL_CONTEXT' | 'UNKNOWN'

export function classifyRootCause(p: Pick<PropRow, 'review_status' | 'source_payload'>): RootCause {
  const sp = p.source_payload as { relevanceScore?: string } | null
  const relevance = sp?.relevanceScore ?? null
  if (p.review_status === 'materialized') return 'SHOULD_HAVE_CBO_BUT_MISSING'
  if (relevance === 'weak') return 'NON_OPERATIONAL_CONTEXT'
  if (relevance === 'strong' || relevance === 'medium') return 'DOCUMENTARY_ACTION_NOT_PROMOTED'
  return 'UNKNOWN'
}

export function upstreamDefectOf(u: FoundingUnit): { flag: boolean; cause: RootCause | null } {
  const actionDeadline = u.props.filter((p) => p.proposal_family === 'action' || p.proposal_family === 'deadline')
  for (const p of actionDeadline) {
    const cause = classifyRootCause(p)
    if (cause === 'SHOULD_HAVE_CBO_BUT_MISSING' || cause === 'DOCUMENTARY_ACTION_NOT_PROMOTED') return { flag: true, cause }
  }
  return { flag: false, cause: null }
}

// ── Plan d'écriture — types (frozen, cf. _p6d1a lignes 360-392). ──────────────────────────

export type HardBasis = 'CBO_FOUNDER' | 'TRACKABLE_FOUNDER' | 'MANUAL_CONFIRMED'

export type PlannedMember = {
  subject_thread_id: string
  scope: 'thread' | 'proposal_set'
  proposal_ids: string[] | null
  evidence_grade: 'HARD'
  resolution_source: 'deterministic'
  hardBasis: HardBasis
}

export type PlannedPoint = {
  label: string
  founding_kind: 'cbo' | 'trackable_condition'
  identity_status: 'CONFIRMED' | 'PROVISIONAL'
  founding_source: string | null
  founding_reference: string
  has_upstream_defect: boolean
  seed_source: 'cbo_seed' | 'thread_seed'
  canonical_subject_id: string | null
  canonical_subject_label: string | null
  member: PlannedMember
}

export type PlannedPendingTrace = {
  source_thread_id: string
  source_proposal_id: string | null
  kind: 'TRACKABILITY_UNDETERMINED' | 'RESOLUTION_WITHOUT_KNOWN_PROBLEM' | 'IDENTITY_UNRESOLVED'
  reason: string
}

export function memberOf(u: FoundingUnit): Omit<PlannedMember, 'hardBasis'> {
  return {
    subject_thread_id: u.threadId,
    scope: u.scope,
    proposal_ids: u.scope === 'proposal_set' ? u.props.map((p) => p.id) : null,
    evidence_grade: 'HARD',
    resolution_source: 'deterministic',
  }
}

// founding_reference d'un unit — mêmes conventions que buildWritePlan (§2.7 du design) :
// thread entier → threadId ; proposal_set → threadId#proposalSetOf.
export function foundingReferenceOf(u: FoundingUnit): string {
  return u.scope === 'thread' ? u.threadId : `${u.threadId}#${u.proposalSetOf}`
}

export type PlanUnitContext = {
  cboLabel?: string | null
  canonicalSubjectId?: string | null
  canonicalSubjectLabel?: string | null
}

/**
 * Plan d'écriture d'UNE FoundingUnit si elle fonde/rejoint un Point (CONFIRMED via CBO,
 * PROVISIONAL via trackable_condition classique ou trackability V2). Retourne null pour tout
 * autre verdict (NO_POINT_*, EXCLUDED_ACTOR_CONTEXT_TEMPORAL, PENDING_TRACKABILITY,
 * RESOLUTION_WITHOUT_KNOWN_PROBLEM[_TRACKABILITY]) — ces verdicts ne produisent jamais de
 * PlannedPoint, cf. planPendingTraceForUnit.
 */
export function planPointForUnit(u: FoundingUnit, ctx: PlanUnitContext = {}): PlannedPoint | null {
  const kind = u.outcomeV2.kind
  const member: PlannedMember = { ...memberOf(u), hardBasis: 'CBO_FOUNDER' }

  if (kind === 'CONFIRMED') {
    member.hardBasis = 'CBO_FOUNDER'
    return {
      label: ctx.cboLabel ?? '(CBO sans libellé)',
      founding_kind: 'cbo',
      identity_status: 'CONFIRMED',
      founding_source: 'canonical_business_object',
      founding_reference: (u.outcomeV2 as { cboId: string }).cboId,
      has_upstream_defect: false,
      seed_source: 'cbo_seed',
      canonical_subject_id: ctx.canonicalSubjectId ?? null,
      canonical_subject_label: ctx.canonicalSubjectLabel ?? null,
      member,
    }
  }

  if (kind === 'PROVISIONAL' || kind === 'PROVISIONAL_TRACKABLE') {
    const { flag, cause } = upstreamDefectOf(u)
    const founding_source = kind === 'PROVISIONAL'
      ? (u.outcomeV2 as { triggerFamily: string }).triggerFamily
      : (cause ? cause.toLowerCase() : 'trackability_v2')
    member.hardBasis = 'TRACKABLE_FOUNDER'
    return {
      label: u.threadLabel,
      founding_kind: 'trackable_condition',
      identity_status: 'PROVISIONAL',
      founding_source,
      founding_reference: foundingReferenceOf(u),
      has_upstream_defect: flag,
      seed_source: 'thread_seed',
      canonical_subject_id: ctx.canonicalSubjectId ?? null,
      canonical_subject_label: ctx.canonicalSubjectLabel ?? null,
      member,
    }
  }

  return null
}

const RESOLUTION_SIGNAL_KINDS = new Set(['RESOLUTION_WITHOUT_KNOWN_PROBLEM', 'RESOLUTION_WITHOUT_KNOWN_PROBLEM_TRACKABILITY'])

/**
 * Trace pending qu'une FoundingUnit produirait si elle ne fonde ni ne rejoint directement un
 * Point (verdicts PENDING_TRACKABILITY / RESOLUTION_WITHOUT_KNOWN_PROBLEM[_TRACKABILITY]).
 * Le choix entre CREATE_PENDING_TRACE (aucun sibling) et CREATE_CANDIDATES (sibling actif sur
 * ce même thread) est arbitré par le RPC live, jamais ici (question d'état LIVE, §2.1/§2.5).
 */
export function planPendingTraceForUnit(u: FoundingUnit): PlannedPendingTrace | null {
  const kind = u.outcomeV2.kind
  if (kind === 'PENDING_TRACKABILITY') {
    return {
      source_thread_id: u.threadId,
      source_proposal_id: null,
      kind: 'TRACKABILITY_UNDETERMINED',
      reason: `Founding unit (scope=${u.scope}${u.proposalSetOf ? `#${u.proposalSetOf}` : ''}) sans famille actionnable classifiable — trackability indéterminée (5E V2).`,
    }
  }
  if (RESOLUTION_SIGNAL_KINDS.has(kind)) {
    return {
      source_thread_id: u.threadId,
      source_proposal_id: null,
      kind: 'RESOLUTION_WITHOUT_KNOWN_PROBLEM',
      reason: `Résolution (${kind}) sans Point sibling connu au moment du plan — le RPC live revérifie l'existence d'un sibling sur ce thread avant de choisir CREATE_PENDING_TRACE ou CREATE_CANDIDATES.`,
    }
  }
  return null
}

// ── Fallback pending trace (Round 4, Vincent — BUG 1) ──────────────────────────────────────
//
// Contrat SÉPARÉ du plan principal — ne remplace ni ne touche plannedPoint/planPendingTraceForUnit,
// et ne lève PAS l'exclusivité plannedPoint XOR plannedPendingTrace (INVALID_PLAN inchangé).
// Chaque fois que planPointForUnit produit un PlannedPoint, le wrapper (tracked-point-live-writer.ts)
// calcule EN PLUS ce fallback et le transmet à la RPC (p_fallback_pending_trace). Il n'est jamais
// matérialisé si le plan de Point passe la revalidation live — seul le RPC (migration 401) le
// consomme, et seulement s'il dégrade effectivement le plan en NEEDS_HUMAN.
//
// kind=IDENTITY_UNRESOLVED est un kind générique unique (migration 400) : la cause précise
// (target fusionnée / target CONFLICTED / plusieurs siblings thread / candidat(s) cross-thread)
// n'est JAMAIS encodée ici en un kind distinct — seulement dans le texte `reason`. Ce texte
// générique n'est qu'un PLACEHOLDER : le RPC reconstruit sa propre `reason` précise à partir de
// ce qu'il observe réellement sous verrou au moment de la dégradation ("ne pas inventer une
// vérité supplémentaire" — le texte ci-dessous n'est jamais écrit tel quel en DB).
export function fallbackPendingTraceForUnit(u: FoundingUnit): PlannedPendingTrace {
  return {
    source_thread_id: u.threadId,
    source_proposal_id: null,
    kind: 'IDENTITY_UNRESOLVED',
    reason: `Fallback générique (scope=${u.scope}${u.proposalSetOf ? `#${u.proposalSetOf}` : ''}) — cause précise de dégradation NEEDS_HUMAN non déterminée hors verrou ; le RPC réécrit ce champ.`,
  }
}

// ── D1 (Round 2, Vincent) — candidats cross-thread pour l'auto-création PROVISIONAL. ──────
//
// Une identité concurrente connue cross-thread ne peut jamais être ignorée puis laisser le RPC
// créer un nouveau Point (§ trackable_condition, jamais étendu à la branche CBO ni à la branche
// pending/resolution — l'identité CBO est déjà arbitrée en amont, et la branche pending ne crée
// jamais de Point). Réutilise tel quel le moteur déterministe de Phase 4
// (evaluateMembershipCandidate, tracked-point-membership-candidates.ts) — pas un second moteur de
// décision, aucun llmJudge branché (rail LLM non câblé, decision jamais UNCERTAIN en pratique).
//
// La liste retournée ici n'est qu'une PROPOSITION calculée hors-lock : le RPC (migration 401)
// revérifie chaque id sous verrou (tracked_point.status='active' AND identity_status<>'CONFLICTED')
// avant d'en tenir compte — cette fonction ne décide jamais elle-même de l'écriture.
export function crossThreadConcurrentPointIds(
  u: FoundingUnit,
  sitePoints: TrackedPointCandidate[],
  ctx: PlanUnitContext = {},
): string[] {
  const candidate: CandidateThreadInput = {
    threadId: u.threadId,
    label: u.threadLabel,
    subjectId: ctx.canonicalSubjectId ?? null,
    subjectLabel: ctx.canonicalSubjectLabel ?? null,
  }
  return sitePoints
    .filter((point) => evaluateMembershipCandidate(candidate, point).decision === 'SAME_POINT')
    .map((point) => point.pointId)
    .sort()
}
