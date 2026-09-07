// Phase 6E.2B — Classification live TRACE_TO_POINT, extraite en fonction PARTAGÉE.
//
// Mandat Vincent (post 6E.2A) : la classification SAFE_SINGLE_TRACE_THREAD / NEEDS_SCOPE_
// REFINEMENT / STALE_NOW_POINT_TO_POINT ne doit JAMAIS être recopiée depuis le script d'audit
// scripts/_p6e2a-trace-to-point-evidence-scope-audit.ts (gelé, READ-ONLY) — elle doit devenir
// "une fonction partagée, et non une copie du script d'audit". Ce module est cette fonction :
// même algorithme (trois mécanismes de rattachement : founder / hard_thread_member /
// hard_proposal_set_member, dérive mesurée via candidate.createdAt), réutilisable par le
// wrapper d'acceptation (lib/db/tracked-point-trace-acceptance.ts) qui doit revalider LIVE
// chaque candidat juste avant d'appeler la RPC — "87 safe au 08/09" est un fait daté, jamais
// une garantie éternelle.
//
// Différence volontaire avec l'audit : l'audit `continue` silencieusement sur les candidats
// déjà POINT_TO_POINT à l'origine (hors de son périmètre 6E.2A). Cette fonction doit répondre
// pour UN candidat désigné par un appelant transactionnel — elle retourne donc une catégorie
// explicite POINT_TO_POINT_AT_ORIGIN plutôt que de ne rien répondre.

import {
  resolveCanonicalPointId,
  PointMergeCycleError,
  PointMergeTargetMissingError,
  PointMergeTargetRetiredError,
  PointMergeCrossSiteError,
  type MergePointCore,
} from './tracked-point-merge'

export type TraceCandidateCategory =
  | 'SAFE_PROPOSAL_SET'
  | 'SAFE_SINGLE_TRACE_THREAD'
  | 'NEEDS_SCOPE_REFINEMENT'
  | 'STALE_NOW_POINT_TO_POINT'
  | 'ALREADY_ASSOCIATED'
  | 'POINT_TO_POINT_AT_ORIGIN'
  | 'TARGET_MISSING'
  | 'TARGET_UNRESOLVABLE'

export type TraceScopePointRow = MergePointCore & {
  foundingKind: 'cbo' | 'trackable_condition' | 'manual'
  foundingReference: string | null
  createdAt: string
}

export type TraceScopeMemberRow = {
  trackedPointId: string
  subjectThreadId: string
  scope: 'thread' | 'proposal_set'
  status: 'active' | 'retired'
  createdAt: string
}

export type TraceScopeCandidateInput = {
  id: string
  siteId: string
  candidatePointId: string
  subjectThreadId: string
  scope: 'thread' | 'proposal_set'
  createdAt: string
}

export type TraceScopeClassification = {
  category: TraceCandidateCategory
  canonicalTargetId: string | null
  sourceOwnPointId: string | null
  relation: 'founder' | 'hard_thread_member' | 'hard_proposal_set_member' | null
  attachedAt: string | null
  blockerReason: string | null
}

// classifyTraceIdentityCandidate : prend l'état COMPLET du site (points/members, comme
// loadTrackedPointConsolidationData) plutôt qu'un sous-ensemble pré-filtré — même convention
// que le reste de la Vague 6E — pour ne jamais dépendre d'un chargement partiel silencieux.
export function classifyTraceIdentityCandidate(
  candidate: TraceScopeCandidateInput,
  points: TraceScopePointRow[],
  members: TraceScopeMemberRow[],
  famillesPresentesDansLeThread: string[],
): TraceScopeClassification {
  const pointsById = new Map(points.map((p) => [p.id, p]))

  const target = pointsById.get(candidate.candidatePointId)
  if (!target) {
    return {
      category: 'TARGET_MISSING',
      canonicalTargetId: null,
      sourceOwnPointId: null,
      relation: null,
      attachedAt: null,
      blockerReason: `candidatePointId introuvable dans tracked_point (${candidate.candidatePointId})`,
    }
  }

  let canonicalTargetId: string
  try {
    canonicalTargetId = resolveCanonicalPointId(candidate.candidatePointId, pointsById as unknown as Map<string, MergePointCore>)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (
      e instanceof PointMergeCycleError ||
      e instanceof PointMergeTargetMissingError ||
      e instanceof PointMergeTargetRetiredError ||
      e instanceof PointMergeCrossSiteError
    ) {
      return {
        category: 'TARGET_UNRESOLVABLE',
        canonicalTargetId: null,
        sourceOwnPointId: null,
        relation: null,
        attachedAt: null,
        blockerReason: message,
      }
    }
    throw e
  }

  // ── mêmes trois mécanismes que deriveCandidatePointPairs / l'audit 6E.2A ──
  const founderThreadToPointId = new Map<string, string>()
  for (const p of points) {
    if (p.foundingKind === 'trackable_condition' && p.foundingReference) {
      if (!founderThreadToPointId.has(p.foundingReference)) founderThreadToPointId.set(p.foundingReference, p.id)
    }
  }

  const hardThreadMemberToPointId = new Map<string, string>()
  const hardThreadMemberCreatedAt = new Map<string, string>()
  const hardProposalSetMembersByThread = new Map<string, TraceScopeMemberRow[]>()
  const activeMembersByThread = new Map<string, TraceScopeMemberRow[]>()
  for (const m of members) {
    if (m.status !== 'active') continue
    const list = activeMembersByThread.get(m.subjectThreadId) ?? []
    list.push(m)
    activeMembersByThread.set(m.subjectThreadId, list)
    if (m.scope === 'thread') {
      hardThreadMemberToPointId.set(m.subjectThreadId, m.trackedPointId)
      hardThreadMemberCreatedAt.set(m.subjectThreadId, m.createdAt)
    } else {
      const psList = hardProposalSetMembersByThread.get(m.subjectThreadId) ?? []
      psList.push(m)
      hardProposalSetMembersByThread.set(m.subjectThreadId, psList)
    }
  }

  let sourceOwnPointId: string | null = null
  let relation: TraceScopeClassification['relation'] = null
  let attachedAt: string | null = null

  const founderPointId = founderThreadToPointId.get(candidate.subjectThreadId)
  if (founderPointId && founderPointId !== candidate.candidatePointId) {
    sourceOwnPointId = founderPointId
    relation = 'founder'
    attachedAt = pointsById.get(founderPointId)?.createdAt ?? null
  }
  if (!sourceOwnPointId) {
    const hardThreadPointId = hardThreadMemberToPointId.get(candidate.subjectThreadId)
    if (hardThreadPointId && hardThreadPointId !== candidate.candidatePointId) {
      sourceOwnPointId = hardThreadPointId
      relation = 'hard_thread_member'
      attachedAt = hardThreadMemberCreatedAt.get(candidate.subjectThreadId) ?? null
    }
  }
  if (!sourceOwnPointId) {
    const proposalSetMembers = hardProposalSetMembersByThread.get(candidate.subjectThreadId) ?? []
    const distinctOther = proposalSetMembers.find((m) => m.trackedPointId !== candidate.candidatePointId)
    if (distinctOther) {
      sourceOwnPointId = distinctOther.trackedPointId
      relation = 'hard_proposal_set_member'
      attachedAt = distinctOther.createdAt
    }
  }

  if (sourceOwnPointId) {
    if (attachedAt && attachedAt > candidate.createdAt) {
      return {
        category: 'STALE_NOW_POINT_TO_POINT',
        canonicalTargetId,
        sourceOwnPointId,
        relation,
        attachedAt,
        blockerReason: `source déjà rattachée (${relation}) à un AUTRE point (${sourceOwnPointId}) depuis ${attachedAt}, postérieur au candidat (${candidate.createdAt})`,
      }
    }
    return {
      category: 'POINT_TO_POINT_AT_ORIGIN',
      canonicalTargetId,
      sourceOwnPointId,
      relation,
      attachedAt,
      blockerReason: `source déjà POINT_TO_POINT à l'origine (${relation} vers ${sourceOwnPointId}) — relève de 6E.1C, pas de 6E.2B`,
    }
  }

  const activeMembers = activeMembersByThread.get(candidate.subjectThreadId) ?? []
  const alreadyMember = activeMembers.find((m) => m.trackedPointId === canonicalTargetId)
  if (alreadyMember) {
    return {
      category: 'ALREADY_ASSOCIATED',
      canonicalTargetId,
      sourceOwnPointId: null,
      relation: null,
      attachedAt: null,
      blockerReason: null,
    }
  }

  if (candidate.scope === 'proposal_set') {
    return {
      category: 'SAFE_PROPOSAL_SET',
      canonicalTargetId,
      sourceOwnPointId: null,
      relation: null,
      attachedAt: null,
      blockerReason: null,
    }
  }

  if (famillesPresentesDansLeThread.length === 1) {
    return {
      category: 'SAFE_SINGLE_TRACE_THREAD',
      canonicalTargetId,
      sourceOwnPointId: null,
      relation: null,
      attachedAt: null,
      blockerReason: null,
    }
  }

  return {
    category: 'NEEDS_SCOPE_REFINEMENT',
    canonicalTargetId,
    sourceOwnPointId: null,
    relation: null,
    attachedAt: null,
    blockerReason: `${famillesPresentesDansLeThread.length} proposal_family distinctes dans le thread — surfusion potentielle, décision humaine requise`,
  }
}
