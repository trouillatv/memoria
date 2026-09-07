// Phase 6B — Point de suivi : read-model/projection au-dessus du schéma persistant
// de la migration 389 (tracked_point / tracked_point_member / tracked_point_identity_candidate).
//
// Garantie d'isolation (Vincent, GO 6B) : tracked_point_identity_candidate reste TOTALEMENT
// hors du reducer. Aucune fonction de ce fichier qui produit un PointReadModelEntry ou une
// tally n'accepte de PendingIdentityCandidate en entrée — c'est une garantie de signature,
// pas seulement conventionnelle. Un candidat, même très confiant, ne dit rien de l'état d'un
// Point tant qu'il n'a pas été accepté ET matérialisé en tracked_point_member evidence_grade=HARD.
//
// RESOLUTION_WITHOUT_KNOWN_PROBLEM : cette classification (scripts/_p5e-trackability-audit.ts)
// reste purement calculée, jamais persistée. Tant qu'aucun humain n'a identifié de Point cible
// concret, la trace ne fonde jamais son propre Point et n'apparaît pas dans ce read-model —
// conformément à la doctrine déjà écrite dans la migration 389 (lignes 122-129). Ne jamais forcer
// un candidate_point_id artificiel pour la faire rentrer dans tracked_point_identity_candidate.
//
// Phase 6B.1 (GO Vincent) — comble le gap ci-dessus pour les événements DOCUMENTAIRES : les
// tracked_point_member actifs/HARD sont résolus vers document_extraction_proposal (jamais vers
// canonical_subject_occurrence, qui n'a ni subject_thread_id ni lien vers les propositions — donc
// pas de granularité par proposition, incompatible avec l'invariant proposal_set ci-dessous) puis
// projetés en PointLifecycleEvent via assemblePointDocumentaryEvents. `decisions` reste [] : aucun
// journal d'événements natifs de décision propre au Point n'existe encore, dette inchangée.
//
// Invariant proposal_set (Vincent, GO 6B.1) : si un thread contient une proposition A rattachée au
// Point X et une proposition B rattachée à une autre condition, et que le membership de X est
// scope='proposal_set' ne ciblant que A, alors B ne doit JAMAIS contaminer le reducer de X. Concrètement :
// la map thread→propositions utilisée pour scope='thread' n'est peuplée QUE depuis la requête par
// subject_thread_id ; scope='proposal_set' consomme EXCLUSIVEMENT tracked_point_member.proposal_ids,
// jamais le thread entier.
//
// resolution_claimed (observation « semble réalisé, à confirmer ») : aucun signal déterministe de
// document_status ne distingue aujourd'hui ce cas des autres statuts documentaires. Volontairement
// NON implémenté ici plutôt qu'inventé — dette documentée, pas masquée (CLAUDE.md §21).

import { createAdminClient } from '@/lib/supabase/admin'
import {
  reduceTrackedPointLifecycle,
  type PointLifecycleEvent,
  type PointCboMember,
  type PointComputedCurrentState,
  type PointMarker,
  type PointTrajectoryEvent,
} from './tracked-point-lifecycle-reducer'
import type { MembershipRail } from './tracked-point-membership-candidates'
import { loadCboReducedStates, loadNonActionCboReducedStates } from './canonical-business-object-evolution'
import { PROPOSAL_PROOF_FAMILY, PROPOSAL_PROOF_STATUS } from './document-completion-resolver'
import { buildPointMergeComponents, resolveCanonicalPointId, type MergeGraphPoint } from './tracked-point-merge'

const FETCH_CHUNK_SIZE = 100

export type TrackedPointStatus = 'active' | 'merged' | 'retired'
export type TrackedPointIdentityStatus = 'CONFIRMED' | 'PROVISIONAL' | 'CONFLICTED'
export type TrackedPointFoundingKind = 'cbo' | 'trackable_condition' | 'manual'

export type TrackedPointRow = {
  id: string
  siteId: string
  canonicalSubjectId: string | null
  label: string
  status: TrackedPointStatus
  mergedIntoId: string | null
  identityStatus: TrackedPointIdentityStatus
  foundingKind: TrackedPointFoundingKind
  foundingSource: string | null
  foundingReference: string | null
  hasUpstreamDefect: boolean
  createdAt: string
}

export type PointReadModelEntry = {
  id: string
  siteId: string
  ownerCanonicalSubjectId: string | null
  label: string
  status: TrackedPointStatus
  mergedIntoId: string | null
  // canonicalPointId (Phase 6E.1A) : égal à `id` pour un Point actif/retired ; sinon la
  // cible résolue via resolveCanonicalPointId (potentiellement multi-hop A→B→C). Un Point
  // merged reste ainsi toujours résoluble même une fois exclu des listes actives.
  canonicalPointId: string
  identityStatus: TrackedPointIdentityStatus
  derivedState: PointComputedCurrentState
  foundingKind: TrackedPointFoundingKind
  foundingSource: string | null
  hasUpstreamDefect: boolean
  cboIds: string[]
  hardMemberThreadIds: string[]
  latestMeaningfulEventAt: string | null
  trajectory: PointTrajectoryEvent[]
  stateBasis: string[]
  markers: PointMarker[]
  documentaryDivergences: string[]
  conflicts: string[]
  toConfirm: boolean
  closedByDecision: boolean
  awaitingDecision: boolean
  hasDocumentaryDivergence: boolean
  hasConflict: boolean
}

export type SubjectPointReadModel = {
  canonicalSubjectId: string
  totalPoints: number
  confirmedPoints: number
  provisionalPoints: number
  conflictedPoints: number
  open: number
  resolved: number
  reopened: number
  unknown: number
  conflict: number
  points: PointReadModelEntry[]
}

export type PendingIdentityCandidateSource = 'membership_engine' | 'resolution_without_known_problem'

export type PendingIdentityCandidateRow = {
  id: string
  siteId: string
  candidateTraceThreadId: string
  candidatePointId: string
  reason: string
  rail: MembershipRail | null
  status: 'pending' | 'accepted' | 'rejected'
}

export type PendingIdentityCandidate = PendingIdentityCandidateRow & {
  source: PendingIdentityCandidateSource
}

// projectTrackedPoint est pure : aucun paramètre de type PendingIdentityCandidate n'existe
// dans sa signature, par construction un candidat ne peut jamais influencer son résultat.
//
// canonicalPointId (Phase 6E.1A) : paramètre optionnel, défaut point.id — préserve tous les
// appels existants à 5 arguments (tests gelés d'avant 6E.1A) inchangés. loadTrackedPointReadModel
// le fournit explicitement, résolu via resolveCanonicalPointId sur l'ensemble du site.
export function projectTrackedPoint(
  point: TrackedPointRow,
  cboMembers: PointCboMember[],
  hardMemberThreadIds: string[],
  decisions: PointLifecycleEvent[] = [],
  docs: PointLifecycleEvent[] = [],
  canonicalPointId: string = point.id,
): PointReadModelEntry {
  const reduced = reduceTrackedPointLifecycle(decisions, docs, cboMembers)
  const latestMeaningfulEventAt =
    reduced.historicalTrajectory.length > 0
      ? reduced.historicalTrajectory[reduced.historicalTrajectory.length - 1].effectiveAt
      : null

  return {
    id: point.id,
    siteId: point.siteId,
    ownerCanonicalSubjectId: point.canonicalSubjectId,
    label: point.label,
    status: point.status,
    mergedIntoId: point.mergedIntoId,
    canonicalPointId,
    identityStatus: point.identityStatus,
    derivedState: reduced.computedCurrentState,
    foundingKind: point.foundingKind,
    foundingSource: point.foundingSource,
    hasUpstreamDefect: point.hasUpstreamDefect,
    cboIds: cboMembers.map((m) => m.cboId),
    hardMemberThreadIds,
    latestMeaningfulEventAt,
    trajectory: reduced.historicalTrajectory,
    stateBasis: reduced.stateBasis,
    markers: reduced.markers,
    documentaryDivergences: reduced.documentaryDivergences,
    conflicts: reduced.conflicts,
    toConfirm: reduced.markers.includes('to_confirm'),
    closedByDecision: reduced.markers.includes('closed_by_decision'),
    awaitingDecision: reduced.markers.includes('awaiting_decision'),
    hasDocumentaryDivergence: reduced.documentaryDivergences.length > 0,
    hasConflict: reduced.conflicts.length > 0,
  }
}

// deriveSubjectPointReadModel ne collapse jamais sur un état global unique : derivedState et
// identityStatus sont comptés indépendamment, jamais l'un dérivé de l'autre.
export function deriveSubjectPointReadModel(
  canonicalSubjectId: string,
  points: PointReadModelEntry[],
): SubjectPointReadModel {
  const tally: SubjectPointReadModel = {
    canonicalSubjectId,
    totalPoints: points.length,
    confirmedPoints: 0,
    provisionalPoints: 0,
    conflictedPoints: 0,
    open: 0,
    resolved: 0,
    reopened: 0,
    unknown: 0,
    conflict: 0,
    points,
  }

  for (const point of points) {
    if (point.identityStatus === 'CONFIRMED') tally.confirmedPoints++
    else if (point.identityStatus === 'PROVISIONAL') tally.provisionalPoints++
    else if (point.identityStatus === 'CONFLICTED') tally.conflictedPoints++

    if (point.derivedState === 'open') tally.open++
    else if (point.derivedState === 'resolved') tally.resolved++
    else if (point.derivedState === 'reopened') tally.reopened++
    else if (point.derivedState === 'unknown') tally.unknown++
    else if (point.derivedState === 'conflict') tally.conflict++
  }

  return tally
}

// projectPendingIdentityCandidates : collection strictement séparée, read-only, jamais
// consommée par le reducer, la trajectoire ou les tallies ci-dessus.
export function projectPendingIdentityCandidates(
  rows: PendingIdentityCandidateRow[],
): PendingIdentityCandidate[] {
  return rows.map((row) => ({
    ...row,
    source: row.rail ? 'membership_engine' : 'resolution_without_known_problem',
  }))
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 6B.1 — bridge HARD membership → événements documentaires réels.
// ─────────────────────────────────────────────────────────────────────────────

export type PointMembershipScope = 'thread' | 'proposal_set'

export type PointMembershipRow = {
  subjectThreadId: string
  scope: PointMembershipScope
  proposalIds: string[] | null
  status: 'active' | 'retired'
}

export type PointDocProposalProvenance = {
  proposalId: string
  proposalFamily: string
  documentStatus: string | null
  date: string | null
}

// Familles dont un document_status='open' porte un signal d'ouverture au niveau Point
// (P0-1G-CONTRAT §7). 'knowledge_fact' n'y figure jamais : sa sémantique de résolution est portée
// séparément par PROPOSAL_PROOF_FAMILY/PROPOSAL_PROOF_STATUS (réutilisés tels quels, jamais redéfinis).
const OPEN_SIGNAL_FAMILIES = new Set(['action', 'reservation', 'observation'])

// selectEligibleProposalIds est pure : résout, pour les memberships HARD/actifs d'UN Point, l'ensemble
// des document_extraction_proposal.id éligibles à alimenter son reducer documentaire. scope='thread'
// consomme la map thread→propositions (peuplée uniquement par requête sur subject_thread_id, jamais
// contaminée par les fetches proposal_set) ; scope='proposal_set' consomme EXCLUSIVEMENT
// membership.proposalIds — c'est l'invariant d'isolation proposal_set (Vincent, GO 6B.1). Un membership
// status='retired' ne contribue jamais.
export function selectEligibleProposalIds(
  members: PointMembershipRow[],
  proposalsByThread: Map<string, string[]>,
): Set<string> {
  const ids = new Set<string>()
  for (const m of members) {
    if (m.status !== 'active') continue
    if (m.scope === 'proposal_set') {
      for (const id of m.proposalIds ?? []) ids.add(id)
      continue
    }
    for (const id of proposalsByThread.get(m.subjectThreadId) ?? []) ids.add(id)
  }
  return ids
}

// assemblePointDocumentaryEvents est pure : traduit des propositions documentaires éligibles en
// PointLifecycleEvent selon le vocabulaire du Point (P0-1G-CONTRAT §7). Symétrique d'assembleCboEvents
// (cbo-lifecycle-reducer.ts) : une date métier non résolue (document sans effective_date) fait sauter
// l'événement — jamais de date de repli inventée (ex. un timestamp d'extraction). Déduplication par
// proposalId (identifiant existant), jamais par texte : une même proposition atteinte deux fois (ex.
// à la fois via scope='thread' d'un membership et scope='proposal_set' d'un autre) ne produit qu'une
// seule contribution.
export function assemblePointDocumentaryEvents(
  proposals: PointDocProposalProvenance[],
): PointLifecycleEvent[] {
  const seen = new Set<string>()
  const events: PointLifecycleEvent[] = []
  for (const p of proposals) {
    if (seen.has(p.proposalId)) continue
    seen.add(p.proposalId)
    if (!p.date) continue // chaîne incomplète (document sans effective_date) → jamais d'événement inventé
    if (p.proposalFamily === PROPOSAL_PROOF_FAMILY && p.documentStatus === PROPOSAL_PROOF_STATUS) {
      events.push({ kind: 'resolution_signal', attestedAt: p.date, eventAt: p.date, source: `proposal:${p.proposalId}` })
    } else if (OPEN_SIGNAL_FAMILIES.has(p.proposalFamily) && p.documentStatus === 'open') {
      events.push({ kind: 'open_signal', attestedAt: p.date, eventAt: p.date, source: `proposal:${p.proposalId}` })
    }
    // resolution_claimed : non implémenté, cf. doctrine en tête de fichier.
  }
  return events
}

async function fetchAllChunks<T>(
  ids: string[],
  fetchChunk: (chunk: string[]) => Promise<T[]>,
): Promise<T[]> {
  if (ids.length === 0) return []
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += FETCH_CHUNK_SIZE) {
    chunks.push(ids.slice(i, i + FETCH_CHUNK_SIZE))
  }
  const results = await Promise.all(chunks.map(fetchChunk))
  return results.flat()
}

export type TrackedPointReadModelResult = {
  points: PointReadModelEntry[]
  mergedPoints: PointReadModelEntry[]
  bySubject: Map<string, SubjectPointReadModel>
  pendingIdentityCandidates: PendingIdentityCandidate[]
}

export async function loadTrackedPointReadModel(siteId: string): Promise<TrackedPointReadModelResult> {
  const supabase = createAdminClient()

  const { data: pointRows, error: pointsError } = await supabase
    .from('tracked_point')
    .select(
      'id, site_id, canonical_subject_id, label, status, merged_into_id, identity_status, founding_kind, founding_source, founding_reference, has_upstream_defect, created_at',
    )
    .eq('site_id', siteId)

  if (pointsError) throw new Error(`loadTrackedPointReadModel: tracked_point — ${pointsError.message}`)

  if (!pointRows || pointRows.length === 0) {
    // Aucun Point n'existe encore pour ce site (attendu en 6B, aucune écriture n'a eu lieu) :
    // collections vides, pas une erreur à masquer.
    return { points: [], mergedPoints: [], bySubject: new Map(), pendingIdentityCandidates: [] }
  }

  const points: TrackedPointRow[] = pointRows.map((r) => ({
    id: r.id,
    siteId: r.site_id,
    canonicalSubjectId: r.canonical_subject_id,
    label: r.label,
    status: r.status,
    mergedIntoId: r.merged_into_id,
    identityStatus: r.identity_status,
    foundingKind: r.founding_kind,
    foundingSource: r.founding_source,
    foundingReference: r.founding_reference,
    hasUpstreamDefect: r.has_upstream_defect,
    createdAt: r.created_at,
  }))

  const pointIds = points.map((p) => p.id)

  // Phase 6E.1A — graphe de fusion du site. Un Point non-merged forme son propre composant
  // singleton (couverture totale garantie par buildPointMergeComponents) : le canonique de
  // chaque Point actif/retired est lui-même tant qu'aucun merge réel n'existe.
  const mergeGraphPoints: MergeGraphPoint[] = points.map((p) => ({
    id: p.id,
    siteId: p.siteId,
    status: p.status,
    mergedIntoId: p.mergedIntoId,
    identityStatus: p.identityStatus,
    createdAt: p.createdAt,
  }))
  const mergeComponents = buildPointMergeComponents(mergeGraphPoints)
  const pointsById = new Map(points.map((p) => [p.id, p]))

  const memberRows = await fetchAllChunks(pointIds, async (chunk) => {
    const { data, error } = await supabase
      .from('tracked_point_member')
      .select('tracked_point_id, subject_thread_id, scope, proposal_ids')
      .in('tracked_point_id', chunk)
      .eq('status', 'active')
      .eq('evidence_grade', 'HARD')
    if (error) throw new Error(`loadTrackedPointReadModel: tracked_point_member — ${error.message}`)
    return data ?? []
  })

  const threadsByPoint = new Map<string, string[]>()
  const membersByPoint = new Map<string, PointMembershipRow[]>()
  for (const row of memberRows) {
    const list = threadsByPoint.get(row.tracked_point_id) ?? []
    list.push(row.subject_thread_id)
    threadsByPoint.set(row.tracked_point_id, list)

    const members = membersByPoint.get(row.tracked_point_id) ?? []
    members.push({
      subjectThreadId: row.subject_thread_id,
      scope: (row.scope ?? 'thread') as PointMembershipScope,
      proposalIds: row.proposal_ids,
      status: 'active', // garanti par le filtre .eq('status', 'active') ci-dessus
    })
    membersByPoint.set(row.tracked_point_id, members)
  }

  // Résolution des memberships HARD vers document_extraction_proposal (Phase 6B.1). Deux requêtes
  // distinctes et non fusionnées : par subject_thread_id (scope='thread') et par id explicite
  // (scope='proposal_set') — proposalsByThread n'est peuplée QUE par la première, jamais par la
  // seconde, pour préserver l'invariant d'isolation proposal_set.
  const allThreadIds = [...new Set(memberRows.filter((r) => (r.scope ?? 'thread') === 'thread').map((r) => r.subject_thread_id))]
  const allExplicitProposalIds = [
    ...new Set(memberRows.filter((r) => r.scope === 'proposal_set').flatMap((r) => r.proposal_ids ?? [])),
  ]

  type ProposalRow = { id: string; subject_thread_id: string | null; proposal_family: string; document_status: string | null; document_id: string }

  const threadProposalRows = await fetchAllChunks<ProposalRow>(allThreadIds, async (chunk) => {
    const { data, error } = await supabase
      .from('document_extraction_proposal')
      .select('id, subject_thread_id, proposal_family, document_status, document_id')
      .in('subject_thread_id', chunk)
    if (error) throw new Error(`loadTrackedPointReadModel: document_extraction_proposal (thread) — ${error.message}`)
    return data ?? []
  })

  const explicitProposalRows = await fetchAllChunks<ProposalRow>(allExplicitProposalIds, async (chunk) => {
    const { data, error } = await supabase
      .from('document_extraction_proposal')
      .select('id, subject_thread_id, proposal_family, document_status, document_id')
      .in('id', chunk)
    if (error) throw new Error(`loadTrackedPointReadModel: document_extraction_proposal (proposal_set) — ${error.message}`)
    return data ?? []
  })

  const proposalsByThread = new Map<string, string[]>()
  for (const row of threadProposalRows) {
    if (!row.subject_thread_id) continue
    const list = proposalsByThread.get(row.subject_thread_id) ?? []
    list.push(row.id)
    proposalsByThread.set(row.subject_thread_id, list)
  }

  const proposalById = new Map<string, ProposalRow>()
  for (const row of [...threadProposalRows, ...explicitProposalRows]) proposalById.set(row.id, row)

  const docIds = [...new Set([...proposalById.values()].map((p) => p.document_id))]
  const docDate = new Map<string, string | null>()
  const docRows = await fetchAllChunks<{ id: string; effective_date: string | null }>(docIds, async (chunk) => {
    const { data, error } = await supabase.from('documents').select('id, effective_date').in('id', chunk)
    if (error) throw new Error(`loadTrackedPointReadModel: documents — ${error.message}`)
    return data ?? []
  })
  for (const d of docRows) docDate.set(d.id, d.effective_date)

  const cboRows = await fetchAllChunks(pointIds, async (chunk) => {
    const { data, error } = await supabase
      .from('canonical_business_object')
      .select('id, tracked_point_id')
      .in('tracked_point_id', chunk)
    if (error) throw new Error(`loadTrackedPointReadModel: canonical_business_object — ${error.message}`)
    return data ?? []
  })

  const cboIdsByPoint = new Map<string, string[]>()
  for (const row of cboRows) {
    if (!row.tracked_point_id) continue
    const list = cboIdsByPoint.get(row.tracked_point_id) ?? []
    list.push(row.id)
    cboIdsByPoint.set(row.tracked_point_id, list)
  }

  // Réutilise le reducer CBO existant, gelé — ne recalcule jamais un verdict CBO ici.
  // 6C.1.A (mandat Vincent 2026-09-07) : un Point doit voir son CBO réel quel que soit son
  // object_type (site_action, site_reserve, site_deadline) — union de deux Maps, chacune scopée
  // à son propre object_type. loadCboReducedStates reste site_action-only et INCHANGÉ (ses autres
  // consommateurs — P0-2/Actions/Debrief/Briefing/nav — présument tous un CBO action) ;
  // loadNonActionCboReducedStates (fonction séparée) couvre site_reserve/site_deadline avec le
  // même moteur de réduction. Les deux Maps sont disjointes par construction (object_type exclusif
  // au niveau de la requête CBO) → l'union ne peut jamais écraser une entrée par une autre.
  const [cboReducedAction, cboReducedNonAction] = await Promise.all([
    loadCboReducedStates(siteId),
    loadNonActionCboReducedStates(siteId),
  ])
  const cboReduced = new Map([...cboReducedAction, ...cboReducedNonAction])

  // buildEvidenceForPointIds : agrège cboMembers/hardMemberThreadIds/docs sur un ENSEMBLE de
  // tracked_point.id (un seul id pour un Point non fusionné ; le composant entier — canonique
  // + descendants merged — pour un Point canonique, Phase 6E.1A). Déduplication par Set : un
  // même CBO ou thread ne peut jamais compter deux fois même s'il apparaît via deux membres du
  // composant.
  function buildEvidenceForPointIds(memberPointIds: string[]): {
    cboMembers: PointCboMember[]
    hardMemberThreadIds: string[]
    docs: PointLifecycleEvent[]
  } {
    const cboIds = [...new Set(memberPointIds.flatMap((id) => cboIdsByPoint.get(id) ?? []))]
    const cboMembers: PointCboMember[] = cboIds
      .map((cboId) => {
        const entry = cboReduced.get(cboId)
        return entry ? { cboId, reduced: entry.reduced } : null
      })
      .filter((m): m is PointCboMember => m !== null)

    const hardMemberThreadIds = [...new Set(memberPointIds.flatMap((id) => threadsByPoint.get(id) ?? []))]

    const members = memberPointIds.flatMap((id) => membersByPoint.get(id) ?? [])
    const eligibleProposalIds = selectEligibleProposalIds(members, proposalsByThread)
    const provenance: PointDocProposalProvenance[] = [...eligibleProposalIds]
      .map((id) => proposalById.get(id))
      .filter((p): p is ProposalRow => p !== undefined)
      .map((p) => ({
        proposalId: p.id,
        proposalFamily: p.proposal_family,
        documentStatus: p.document_status,
        date: docDate.get(p.document_id) ?? null,
      }))
    const docs = assemblePointDocumentaryEvents(provenance)

    return { cboMembers, hardMemberThreadIds, docs }
  }

  // Phase 6E.1A — un Point status='merged' est exclu des listes actives (readModelPoints)
  // mais reste individuellement résoluble (mergedPoints), avec sa PROPRE évidence non agrégée
  // (l'évidence agrégée vit désormais sur son canonique, ci-dessous). Un Point canonique
  // (non-merged) agrège l'évidence de tout son composant de fusion — lui-même seul tant
  // qu'aucun merge réel n'existe (couverture totale garantie par buildPointMergeComponents).
  const readModelPoints: PointReadModelEntry[] = []
  const mergedPoints: PointReadModelEntry[] = []

  for (const point of points) {
    if (point.status === 'merged') {
      const { cboMembers, hardMemberThreadIds, docs } = buildEvidenceForPointIds([point.id])
      const canonicalPointId = resolveCanonicalPointId(point.id, pointsById)
      mergedPoints.push(projectTrackedPoint(point, cboMembers, hardMemberThreadIds, [], docs, canonicalPointId))
      continue
    }

    const component = mergeComponents.get(point.id)
    const memberPointIds = component ? component.memberPointIds : [point.id]
    const { cboMembers, hardMemberThreadIds, docs } = buildEvidenceForPointIds(memberPointIds)
    readModelPoints.push(projectTrackedPoint(point, cboMembers, hardMemberThreadIds, [], docs, point.id))
  }

  const bySubject = new Map<string, SubjectPointReadModel>()
  const pointsBySubject = new Map<string, PointReadModelEntry[]>()
  for (const entry of readModelPoints) {
    if (!entry.ownerCanonicalSubjectId) continue
    const list = pointsBySubject.get(entry.ownerCanonicalSubjectId) ?? []
    list.push(entry)
    pointsBySubject.set(entry.ownerCanonicalSubjectId, list)
  }
  for (const [subjectId, subjectPoints] of pointsBySubject) {
    bySubject.set(subjectId, deriveSubjectPointReadModel(subjectId, subjectPoints))
  }

  const { data: candidateRows, error: candidateError } = await supabase
    .from('tracked_point_identity_candidate')
    .select('id, site_id, subject_thread_id, candidate_point_id, reason, rail, status')
    .eq('site_id', siteId)

  if (candidateError) {
    throw new Error(`loadTrackedPointReadModel: tracked_point_identity_candidate — ${candidateError.message}`)
  }

  const pendingIdentityCandidates = projectPendingIdentityCandidates(
    (candidateRows ?? []).map((r) => ({
      id: r.id,
      siteId: r.site_id,
      candidateTraceThreadId: r.subject_thread_id,
      candidatePointId: r.candidate_point_id,
      reason: r.reason,
      rail: r.rail,
      status: r.status,
    })),
  )

  return { points: readModelPoints, mergedPoints, bySubject, pendingIdentityCandidates }
}
