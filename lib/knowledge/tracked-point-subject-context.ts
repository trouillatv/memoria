// Mini-contexte Sujet — fiche Point (mandat Vincent 2026-09-14, GO Option B).
//
// Option B explicitement retenue par Vincent contre Option A : ce loader charge UNIQUEMENT les
// tracked_point du sujet propriétaire du Point courant (canonical_subject_id = X), jamais
// loadTrackedPointReadModel(siteId) qui recalcule le site entier — page ouverte à répétition sur
// le terrain, le coût site-entier est une dette de performance qu'Option A aurait introduite
// sans nécessité (« architecturalement mauvais », Vincent).
//
// Réutilisation stricte (mandat) : aucune règle open/resolved/reopened ni aucune agrégation CBO
// n'est recalculée ici. deriveSubjectPointReadModel, projectTrackedPoint, assemblePointEvidence,
// sortPointsForSubjectDisplay et fetchAllChunks sont importés tels quels depuis
// tracked-point-read-model.ts — ce module n'ajoute qu'une requête scopée + la détection de fusion
// cross-sujet ci-dessous, jamais un second moteur de statut.
//
// Fusion cross-sujet (0 ligne mergée en production aujourd'hui, cf. tracked-point-merge.ts) :
// buildPointMergeComponents ne doit JAMAIS être appelé sur une population partielle (scopée à un
// seul sujet) si une chaîne de fusion peut sortir de cette population — resolveCanonicalPointId
// lève PointMergeTargetMissingError sur une cible absente de la map fournie. Deux détections
// distinctes, chacune sans charger le site entier :
//   - sortante (pure, sans IO) : un point de CE sujet dont merged_into_id ne fait pas partie de
//     l'ensemble de points déjà chargé pour ce sujet fusionne forcément vers un point d'un AUTRE
//     sujet (tout point cible légitime du même sujet serait déjà dans le résultat de la requête
//     scopée) ;
//   - entrante (une requête étroite : tracked_point où merged_into_id IN (nos ids), puis on
//     vérifie si l'id du point renvoyé n'appartient pas à notre propre ensemble) : un point d'un
//     AUTRE sujet a fusionné dans un des nôtres, invisible depuis notre seule requête scopée.
// Si l'un ou l'autre signal est détecté, dégradation globale et uniforme : chaque point de ce
// sujet redevient un composant singleton (jamais d'agrégation partielle/incohérente), et
// crossSubjectMergeDetected=true signale à l'UI que la vue est un mini-contexte, pas la vérité
// complète (déjà couvert par le lien « Voir le sujet complet »).
//
// Un point status='merged' est TOUJOURS exclu de la tally/liste retournée ici (jamais affiché
// séparément de son canonique), pour ne jamais compter deux fois la même évidence — même
// exclusion que readModelPoints/mergedPoints dans loadTrackedPointReadModel.

import { createAdminClient } from '@/lib/supabase/admin'
import {
  assemblePointEvidence,
  deriveSubjectPointReadModel,
  fetchAllChunks,
  projectTrackedPoint,
  sortPointsForSubjectDisplay,
  type PointEvidenceLookups,
  type PointMembershipRow,
  type PointMembershipScope,
  type PointProposalRow,
  type PointReadModelEntry,
  type TrackedPointFoundingKind,
  type TrackedPointIdentityStatus,
  type TrackedPointRow,
  type TrackedPointStatus,
} from './tracked-point-read-model'
import { loadCboReducedStates, loadNonActionCboReducedStates } from './canonical-business-object-evolution'
import { buildPointMergeComponents, type MergeGraphPoint } from './tracked-point-merge'

export type SubjectPointMiniContextEntry = PointReadModelEntry & { isCurrent: boolean }

export type SubjectPointMiniContext = {
  canonicalSubjectId: string
  totalPoints: number
  open: number
  resolved: number
  reopened: number
  unknown: number
  conflict: number
  points: SubjectPointMiniContextEntry[]
  crossSubjectMergeDetected: boolean
}

function emptyMiniContext(canonicalSubjectId: string): SubjectPointMiniContext {
  return {
    canonicalSubjectId,
    totalPoints: 0,
    open: 0,
    resolved: 0,
    reopened: 0,
    unknown: 0,
    conflict: 0,
    points: [],
    crossSubjectMergeDetected: false,
  }
}

/** Coeur pur, entièrement testable sans IO : `points` est déjà scopé au sujet (requête de
 *  l'appelant), `incomingCrossDetected` est déjà résolu par l'appelant (requête étroite séparée).
 *  Ne recalcule jamais open/resolved/reopened : délègue entièrement à deriveSubjectPointReadModel
 *  + projectTrackedPoint, réutilisés tels quels. */
export function buildSubjectPointMiniContext(
  canonicalSubjectId: string,
  currentPointId: string,
  points: TrackedPointRow[],
  incomingCrossDetected: boolean,
  evidenceLookups: PointEvidenceLookups,
): SubjectPointMiniContext {
  if (points.length === 0) return emptyMiniContext(canonicalSubjectId)

  const ownIdSet = new Set(points.map((p) => p.id))
  const outgoingCrossDetected = points.some((p) => p.mergedIntoId !== null && !ownIdSet.has(p.mergedIntoId))
  const crossSubjectMergeDetected = outgoingCrossDetected || incomingCrossDetected

  let mergeComponents: Map<string, { canonicalPointId: string; memberPointIds: string[] }> | null = null
  if (!crossSubjectMergeDetected) {
    const mergeGraphPoints: MergeGraphPoint[] = points.map((p) => ({
      id: p.id,
      siteId: p.siteId,
      status: p.status,
      mergedIntoId: p.mergedIntoId,
      identityStatus: p.identityStatus,
      createdAt: p.createdAt,
    }))
    mergeComponents = buildPointMergeComponents(mergeGraphPoints)
  }

  const entries: PointReadModelEntry[] = []
  for (const point of points) {
    if (point.status === 'merged') continue // jamais affiché séparément de son canonique, cf. doctrine en tête de fichier

    const memberPointIds = crossSubjectMergeDetected
      ? [point.id]
      : (mergeComponents!.get(point.id)?.memberPointIds ?? [point.id])
    const { cboMembers, hardMemberThreadIds, docs } = assemblePointEvidence(memberPointIds, evidenceLookups)
    entries.push(projectTrackedPoint(point, cboMembers, hardMemberThreadIds, [], docs, point.id))
  }

  const tally = deriveSubjectPointReadModel(canonicalSubjectId, entries)
  const orderedPoints: SubjectPointMiniContextEntry[] = sortPointsForSubjectDisplay(tally.points).map((p) => ({
    ...p,
    isCurrent: p.id === currentPointId,
  }))

  return {
    canonicalSubjectId,
    totalPoints: tally.totalPoints,
    open: tally.open,
    resolved: tally.resolved,
    reopened: tally.reopened,
    unknown: tally.unknown,
    conflict: tally.conflict,
    points: orderedPoints,
    crossSubjectMergeDetected,
  }
}

type TrackedPointDbRow = {
  id: string
  site_id: string
  canonical_subject_id: string | null
  label: string
  status: TrackedPointStatus
  merged_into_id: string | null
  identity_status: TrackedPointIdentityStatus
  founding_kind: TrackedPointFoundingKind
  founding_source: string | null
  founding_reference: string | null
  has_upstream_defect: boolean
  created_at: string
}

function toTrackedPointRow(r: TrackedPointDbRow): TrackedPointRow {
  return {
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
  }
}

/** IO wrapper : requêtes toutes scopées au sujet (jamais siteId seul), délègue tout calcul au
 *  coeur pur ci-dessus. Retourne null seulement quand le Point courant n'a pas de sujet
 *  propriétaire (rien à charger) — pas une erreur, un état légitime (Point encore orphelin). */
export async function loadSubjectPointMiniContext(
  siteId: string,
  canonicalSubjectId: string | null,
  currentPointId: string,
): Promise<SubjectPointMiniContext | null> {
  if (!canonicalSubjectId) return null

  const supabase = createAdminClient()

  const { data: pointRows, error: pointsError } = await supabase
    .from('tracked_point')
    .select(
      'id, site_id, canonical_subject_id, label, status, merged_into_id, identity_status, founding_kind, founding_source, founding_reference, has_upstream_defect, created_at',
    )
    .eq('site_id', siteId)
    .eq('canonical_subject_id', canonicalSubjectId)

  if (pointsError) throw new Error(`loadSubjectPointMiniContext: tracked_point — ${pointsError.message}`)
  if (!pointRows || pointRows.length === 0) return emptyMiniContext(canonicalSubjectId)

  const points = (pointRows as TrackedPointDbRow[]).map(toTrackedPointRow)
  const pointIds = points.map((p) => p.id)
  const ownIdSet = new Set(pointIds)

  // Détection entrante — étroite : ne charge que les points d'AUTRES sujets qui fusionnent vers
  // l'un des nôtres, jamais le site entier.
  const { data: incomingRows, error: incomingError } = await supabase
    .from('tracked_point')
    .select('id')
    .eq('site_id', siteId)
    .in('merged_into_id', pointIds)
  if (incomingError) throw new Error(`loadSubjectPointMiniContext: tracked_point (incoming) — ${incomingError.message}`)
  const incomingCrossDetected = (incomingRows ?? []).some((r) => !ownIdSet.has(r.id))

  const memberRows = await fetchAllChunks(pointIds, async (chunk) => {
    const { data, error } = await supabase
      .from('tracked_point_member')
      .select('tracked_point_id, subject_thread_id, scope, proposal_ids')
      .in('tracked_point_id', chunk)
      .eq('status', 'active')
      .eq('evidence_grade', 'HARD')
    if (error) throw new Error(`loadSubjectPointMiniContext: tracked_point_member — ${error.message}`)
    return data ?? []
  })

  const threadsByPoint = new Map<string, string[]>()
  const membersByPoint = new Map<string, PointMembershipRow[]>()
  for (const row of memberRows) {
    const threadList = threadsByPoint.get(row.tracked_point_id) ?? []
    threadList.push(row.subject_thread_id)
    threadsByPoint.set(row.tracked_point_id, threadList)

    const members = membersByPoint.get(row.tracked_point_id) ?? []
    members.push({
      subjectThreadId: row.subject_thread_id,
      scope: (row.scope ?? 'thread') as PointMembershipScope,
      proposalIds: row.proposal_ids,
      status: 'active',
    })
    membersByPoint.set(row.tracked_point_id, members)
  }

  const allThreadIds = [...new Set(memberRows.filter((r) => (r.scope ?? 'thread') === 'thread').map((r) => r.subject_thread_id))]
  const allExplicitProposalIds = [
    ...new Set(memberRows.filter((r) => r.scope === 'proposal_set').flatMap((r) => r.proposal_ids ?? [])),
  ]

  const threadProposalRows = await fetchAllChunks<PointProposalRow>(allThreadIds, async (chunk) => {
    const { data, error } = await supabase
      .from('document_extraction_proposal')
      .select('id, subject_thread_id, proposal_family, document_status, document_id')
      .in('subject_thread_id', chunk)
    if (error) throw new Error(`loadSubjectPointMiniContext: document_extraction_proposal (thread) — ${error.message}`)
    return data ?? []
  })

  const explicitProposalRows = await fetchAllChunks<PointProposalRow>(allExplicitProposalIds, async (chunk) => {
    const { data, error } = await supabase
      .from('document_extraction_proposal')
      .select('id, subject_thread_id, proposal_family, document_status, document_id')
      .in('id', chunk)
    if (error) throw new Error(`loadSubjectPointMiniContext: document_extraction_proposal (proposal_set) — ${error.message}`)
    return data ?? []
  })

  const proposalsByThread = new Map<string, string[]>()
  for (const row of threadProposalRows) {
    if (!row.subject_thread_id) continue
    const list = proposalsByThread.get(row.subject_thread_id) ?? []
    list.push(row.id)
    proposalsByThread.set(row.subject_thread_id, list)
  }

  const proposalById = new Map<string, PointProposalRow>()
  for (const row of [...threadProposalRows, ...explicitProposalRows]) proposalById.set(row.id, row)

  const docIds = [...new Set([...proposalById.values()].map((p) => p.document_id))]
  const docDate = new Map<string, string | null>()
  const docRows = await fetchAllChunks<{ id: string; effective_date: string | null }>(docIds, async (chunk) => {
    const { data, error } = await supabase.from('documents').select('id, effective_date').in('id', chunk)
    if (error) throw new Error(`loadSubjectPointMiniContext: documents — ${error.message}`)
    return data ?? []
  })
  for (const d of docRows) docDate.set(d.id, d.effective_date)

  const cboRows = await fetchAllChunks(pointIds, async (chunk) => {
    const { data, error } = await supabase
      .from('canonical_business_object')
      .select('id, tracked_point_id')
      .in('tracked_point_id', chunk)
    if (error) throw new Error(`loadSubjectPointMiniContext: canonical_business_object — ${error.message}`)
    return data ?? []
  })

  const cboIdsByPoint = new Map<string, string[]>()
  for (const row of cboRows) {
    if (!row.tracked_point_id) continue
    const list = cboIdsByPoint.get(row.tracked_point_id) ?? []
    list.push(row.id)
    cboIdsByPoint.set(row.tracked_point_id, list)
  }

  // Le gain de perf réel d'Option B : réduction CBO scopée au sujet, jamais site entier.
  const [cboReducedAction, cboReducedNonAction] = await Promise.all([
    loadCboReducedStates(siteId, { canonicalSubjectId }),
    loadNonActionCboReducedStates(siteId, { canonicalSubjectId }),
  ])
  const cboReduced = new Map([...cboReducedAction, ...cboReducedNonAction])

  const evidenceLookups: PointEvidenceLookups = {
    cboIdsByPoint,
    cboReduced,
    threadsByPoint,
    membersByPoint,
    proposalsByThread,
    proposalById,
    docDate,
  }

  return buildSubjectPointMiniContext(canonicalSubjectId, currentPointId, points, incomingCrossDetected, evidenceLookups)
}
