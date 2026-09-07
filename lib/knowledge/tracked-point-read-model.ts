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
// Dette connue : il n'existe pas encore de journal d'événements natifs propre au Point (l'équivalent
// de site_action_events pour les CBO). Le chemin DB de loadTrackedPointReadModel passe donc toujours
// decisions=[] et docs=[] à projectTrackedPoint — un Point réel n'est aujourd'hui évalué qu'au travers
// du verdict de ses CBO ("ligne 12" de la table de vérité du reducer). Ce n'est pas un blocage pour
// 6B (0 Point réel existe, écriture reportée en 6C) mais doit être visible, pas masqué.

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
import { loadCboReducedStates } from './canonical-business-object-evolution'

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
}

export type PointReadModelEntry = {
  id: string
  siteId: string
  ownerCanonicalSubjectId: string | null
  label: string
  status: TrackedPointStatus
  mergedIntoId: string | null
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
export function projectTrackedPoint(
  point: TrackedPointRow,
  cboMembers: PointCboMember[],
  hardMemberThreadIds: string[],
  decisions: PointLifecycleEvent[] = [],
  docs: PointLifecycleEvent[] = [],
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
  bySubject: Map<string, SubjectPointReadModel>
  pendingIdentityCandidates: PendingIdentityCandidate[]
}

export async function loadTrackedPointReadModel(siteId: string): Promise<TrackedPointReadModelResult> {
  const supabase = createAdminClient()

  const { data: pointRows, error: pointsError } = await supabase
    .from('tracked_point')
    .select(
      'id, site_id, canonical_subject_id, label, status, merged_into_id, identity_status, founding_kind, founding_source, founding_reference, has_upstream_defect',
    )
    .eq('site_id', siteId)

  if (pointsError) throw new Error(`loadTrackedPointReadModel: tracked_point — ${pointsError.message}`)

  if (!pointRows || pointRows.length === 0) {
    // Aucun Point n'existe encore pour ce site (attendu en 6B, aucune écriture n'a eu lieu) :
    // collections vides, pas une erreur à masquer.
    return { points: [], bySubject: new Map(), pendingIdentityCandidates: [] }
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
  }))

  const pointIds = points.map((p) => p.id)

  const memberRows = await fetchAllChunks(pointIds, async (chunk) => {
    const { data, error } = await supabase
      .from('tracked_point_member')
      .select('tracked_point_id, subject_thread_id')
      .in('tracked_point_id', chunk)
      .eq('status', 'active')
      .eq('evidence_grade', 'HARD')
    if (error) throw new Error(`loadTrackedPointReadModel: tracked_point_member — ${error.message}`)
    return data ?? []
  })

  const threadsByPoint = new Map<string, string[]>()
  for (const row of memberRows) {
    const list = threadsByPoint.get(row.tracked_point_id) ?? []
    list.push(row.subject_thread_id)
    threadsByPoint.set(row.tracked_point_id, list)
  }

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
  // Limitation documentée : ne couvre que object_type='site_action' ; un tracked_point_id
  // pointant vers un autre object_type serait silencieusement absent de cette Map.
  const cboReduced = await loadCboReducedStates(siteId)

  const readModelPoints: PointReadModelEntry[] = points.map((point) => {
    const cboIds = cboIdsByPoint.get(point.id) ?? []
    const cboMembers: PointCboMember[] = cboIds
      .map((cboId) => {
        const entry = cboReduced.get(cboId)
        return entry ? { cboId, reduced: entry.reduced } : null
      })
      .filter((m): m is PointCboMember => m !== null)
    const hardMemberThreadIds = threadsByPoint.get(point.id) ?? []

    return projectTrackedPoint(point, cboMembers, hardMemberThreadIds, [], [])
  })

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

  return { points: readModelPoints, bySubject, pendingIdentityCandidates }
}
