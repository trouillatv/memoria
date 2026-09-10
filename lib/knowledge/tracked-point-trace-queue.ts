// Phase 6E.2C — read-model de file d'identité TRACE_TO_POINT (déliverable 1/5).
//
// Mandat Vincent : "productisation SAFE de TRACE_TO_POINT, zéro nouvel APPLY métier". Ce module
// ne fait AUCUNE écriture — c'est le pendant, pour TRACE→Point, de buildConsolidationQueue /
// loadConsolidationQueue (tracked-point-consolidation-queue.ts) pour Point↔Point. Même
// convention de fichier : une fonction pure (buildTraceIdentityQueue) + un chargeur async
// séparé (loadTraceIdentityQueue) qui l'alimente depuis l'état vivant.
//
// L'unité côté utilisateur est la SOURCE (subject_thread_id), jamais une ligne par candidate :
// 31% des sources sont multi-cibles (audit 6E.2A) — une seule carte par source, ses cibles
// possibles apparaissant comme targets[] (1 cible = question binaire, 2+ = choix), jamais
// plusieurs cartes indépendantes pour la même source.
//
// La classification n'est JAMAIS gelée comme propriété statique d'une ligne candidate : elle
// est recalculée EN DIRECT à chaque lecture via classifyTraceIdentityCandidate — la même
// fonction partagée que le wrapper d'acceptation (tracked-point-trace-acceptance.ts), jamais
// une copie — pour capturer les mêmes dérives que ce wrapper revalide avant d'écrire : source
// devenue fondatrice d'un point tiers, target mergé/retired, scope redevenu ambigu.
//
// Invariant structurel (jamais du code de synchronisation) : les candidats classés
// POINT_TO_POINT_AT_ORIGIN / STALE_NOW_POINT_TO_POINT sont EXACTEMENT ceux que
// deriveCandidatePointPairs (tracked-point-merge.ts) transforme en paires Point↔Point — les
// exclure de targets[] garantit par construction que la file TRACE et la file Point↔Point ne
// proposent jamais la même décision d'identité sous deux formes différentes. ALREADY_ASSOCIATED
// est exclu pour la même raison : plus aucune décision n'y est attachée (la membership existe déjà).
//
// STALE_TARGET (mérite un statut propre, absent de TraceCandidateCategory qui "voit à travers"
// les fusions pour les besoins de classification) : quand candidate_point_id a été fusionné
// dans un autre point DEPUIS la pose du candidat, classifyTraceIdentityCandidate résout et
// classe normalement relativement au point CANONIQUE — mais la RPC d'acceptation, elle, lit
// candidate_point_id tel quel et refuse tout target non-actif (cf. test STALE_TARGET,
// tracked-point-trace-acceptance.test.ts). Exposer canonicalPointId ≠ pointId sans le masquer
// derrière une classification "safe" est le seul moyen de ne pas offrir un "Associer" qui
// échouerait côté serveur — recalculé ici, jamais mémorisé.
//
// Fermeture humaine de IDENTITY_UNRESOLVED après rejet de tous les candidats (mandat Vincent) :
// avant ce correctif, une source dont TOUS les candidats sont rejetés/consommés quittait la file
// en silence (targets.length===0 → continue) alors que sa tracked_point_pending_trace
// kind=IDENTITY_UNRESOLVED reste 'pending' en base — invisible et bloquée. pendingTraceIdByThreadId
// (chargé indépendamment des candidats) permet désormais d'ajouter une entrée FALLBACK pour toute
// pending trace encore ouverte dont aucun candidat n'est plus actionnable, avec
// needsFreeIdentityResolution=true : la carte propose alors les deux gestures humaines libres
// (associer à un autre Point existant / créer un nouveau Point), jamais un nouveau matching
// automatique.

import { createAdminClient } from '@/lib/supabase/admin'
import { loadTrackedPointReadModel, type PointReadModelEntry } from './tracked-point-read-model'
import {
  classifyTraceIdentityCandidate,
  type TraceScopePointRow,
  type TraceScopeMemberRow,
  type TraceScopeCandidateInput,
  type TraceScopeClassification,
} from './tracked-point-trace-scope'

export type TraceIdentityTargetActionability =
  | 'ACTIONABLE'
  | 'NEEDS_SCOPE_REFINEMENT'
  | 'STALE_TARGET'
  | 'TARGET_MISSING'
  | 'TARGET_UNRESOLVABLE'

export type TraceIdentityTarget = {
  candidateId: string
  pointId: string
  canonicalPointId: string | null
  scope: 'thread' | 'proposal_set'
  label: string | null
  identityStatus: PointReadModelEntry['identityStatus'] | null
  derivedState: PointReadModelEntry['derivedState'] | null
  subject: PointReadModelEntry['ownerCanonicalSubjectId']
  subjectLabel: string | null
  latestMeaningfulEventAt: string | null
  cboCount: number
  hardMemberCount: number
  actionability: TraceIdentityTargetActionability
  blockerReason: string | null
  classification: TraceScopeClassification
}

export type TraceIdentitySourceEvidenceScopeStatus = 'ACTIONABLE' | 'PARTIALLY_ACTIONABLE' | 'BLOCKED'

export type TraceIdentitySourceProposal = {
  id: string
  label: string | null
  proposalFamily: string
  documentId: string | null
  documentFilename: string | null
  documentType: string | null
  documentEffectiveDate: string | null
  sourcePage: number | null
  sourceExcerpt: string | null
  createdAt: string | null
}

export type TraceIdentitySourceEntry = {
  // sourceKey (Vincent) : identifiant d'affichage stable de la carte, égal à sourceThreadId
  // aujourd'hui — champ distinct pour ne jamais coupler le contrat d'affichage à la forme
  // exacte de la clé de regroupement si elle devait un jour évoluer (ex. granularité proposal_set).
  sourceKey: string
  sourceThreadId: string
  sourceProposalIds: string[]
  scope: 'thread' | 'proposal_set' | 'mixed'
  sourceLabel: string | null
  sourceDocumentId: string | null
  sourceDocumentFilename: string | null
  sourceDocumentType: string | null
  sourceDocumentEffectiveDate: string | null
  sourcePage: number | null
  // sourceExcerpt/hasVerbatimExcerpt (6E.4B/A1-A2, mandat Vincent 2026-09-08) : distingue une
  // citation réelle (source_excerpt persisté, jamais modifié après insertion) d'un label
  // reformulé par l'extraction — jamais présenté comme une citation quand ce n'en est pas une.
  sourceExcerpt: string | null
  hasVerbatimExcerpt: boolean
  sourceDate: string | null
  targets: TraceIdentityTarget[]
  targetCount: number
  evidenceScopeStatus: TraceIdentitySourceEvidenceScopeStatus
  // pendingTraceId/needsFreeIdentityResolution (mandat Vincent, fermeture IDENTITY_UNRESOLVED) :
  // pendingTraceId n'est jamais null pour une entrée FALLBACK (needsFreeIdentityResolution=true)
  // — c'est l'identifiant que les deux gestures libres (associer / créer) exigent en entrée. Pour
  // une entrée normale (candidats encore actionnables), needsFreeIdentityResolution reste false ;
  // pendingTraceId peut être renseigné (source couverte par une pending trace) ou non (ancien
  // comportement, aucune pending trace connue pour cette source).
  pendingTraceId: string | null
  needsFreeIdentityResolution: boolean
}

export type TraceIdentityQueue = {
  siteId: string
  entries: TraceIdentitySourceEntry[]
  totalSources: number
  totalTargets: number
}

const DROPPED_FROM_TARGETS: TraceScopeClassification['category'][] = [
  'POINT_TO_POINT_AT_ORIGIN',
  'STALE_NOW_POINT_TO_POINT',
  'ALREADY_ASSOCIATED',
]

const NEEDS_SCOPE_REFINEMENT_REASON = 'INSUFFICIENT_EVIDENCE_SCOPE'

function deriveActionability(
  classification: TraceScopeClassification,
  candidate: TraceScopeCandidateInput,
): { actionability: TraceIdentityTargetActionability; blockerReason: string | null } {
  if (classification.category === 'TARGET_MISSING' || classification.category === 'TARGET_UNRESOLVABLE') {
    return { actionability: classification.category, blockerReason: classification.blockerReason }
  }
  // Dérive détectée entre la target STOCKÉE sur le candidat et sa cible canonique actuelle :
  // classifyTraceIdentityCandidate résout et classe malgré tout (utile pour d'autres appelants),
  // mais ici aucune action ne doit être offerte tant que ce n'est pas retombé sur un état stable.
  if (classification.canonicalTargetId && classification.canonicalTargetId !== candidate.candidatePointId) {
    return {
      actionability: 'STALE_TARGET',
      blockerReason: `candidate_point_id (${candidate.candidatePointId}) a été fusionné vers ${classification.canonicalTargetId} depuis la pose du candidat — à recalculer avant toute action`,
    }
  }
  if (classification.category === 'NEEDS_SCOPE_REFINEMENT') {
    return { actionability: 'NEEDS_SCOPE_REFINEMENT', blockerReason: NEEDS_SCOPE_REFINEMENT_REASON }
  }
  return { actionability: 'ACTIONABLE', blockerReason: null }
}

// buildTraceIdentityQueue : pur. N'accepte que des candidats déjà filtrés status='pending' par
// l'appelant (même convention que loadTraceIdentityQueue) — un candidat déjà accepted/rejected
// n'a plus sa place dans une file de décisions à prendre.
export function buildTraceIdentityQueue(
  siteId: string,
  candidates: TraceScopeCandidateInput[],
  points: TraceScopePointRow[],
  members: TraceScopeMemberRow[],
  famillesByThreadId: Map<string, string[]>,
  pointDetailsById: Map<string, PointReadModelEntry>,
  proposalsByThreadId: Map<string, TraceIdentitySourceProposal[]>,
  subjectLabelBySubjectId: Map<string, string | null>,
  pendingTraceIdByThreadId: Map<string, string> = new Map(),
): TraceIdentityQueue {
  const bySource = new Map<string, TraceScopeCandidateInput[]>()
  for (const c of candidates) {
    const list = bySource.get(c.subjectThreadId) ?? []
    list.push(c)
    bySource.set(c.subjectThreadId, list)
  }

  const entries: TraceIdentitySourceEntry[] = []

  for (const [sourceThreadId, sourceCandidates] of bySource) {
    const famillesPresentes = famillesByThreadId.get(sourceThreadId) ?? []
    const targets: TraceIdentityTarget[] = []

    for (const candidate of sourceCandidates) {
      const classification = classifyTraceIdentityCandidate(candidate, points, members, famillesPresentes)
      if (DROPPED_FROM_TARGETS.includes(classification.category)) continue

      const pointDetail = pointDetailsById.get(classification.canonicalTargetId ?? candidate.candidatePointId)
      const { actionability, blockerReason } = deriveActionability(classification, candidate)
      const targetSubjectId = pointDetail?.ownerCanonicalSubjectId ?? null

      targets.push({
        candidateId: candidate.id,
        pointId: candidate.candidatePointId,
        canonicalPointId: classification.canonicalTargetId,
        scope: candidate.scope,
        label: pointDetail?.label ?? null,
        identityStatus: pointDetail?.identityStatus ?? null,
        derivedState: pointDetail?.derivedState ?? null,
        subject: targetSubjectId,
        subjectLabel: targetSubjectId ? (subjectLabelBySubjectId.get(targetSubjectId) ?? null) : null,
        latestMeaningfulEventAt: pointDetail?.latestMeaningfulEventAt ?? null,
        cboCount: pointDetail?.cboIds.length ?? 0,
        hardMemberCount: pointDetail?.hardMemberThreadIds.length ?? 0,
        actionability,
        blockerReason,
        classification,
      })
    }

    // Source structurellement vidée (tous ses candidats sont devenus POINT_TO_POINT / déjà
    // associés, ou rejetés) : elle ne produit pas d'entrée ICI. Un Point↔Point équivalent, s'il
    // existe, vit désormais dans buildConsolidationQueue. Si une tracked_point_pending_trace
    // IDENTITY_UNRESOLVED reste 'pending' pour cette source, le second passage FALLBACK plus bas
    // la réintroduit — ce n'est donc plus systématiquement une disparition silencieuse.
    if (targets.length === 0) continue

    const allActionable = targets.every((t) => t.actionability === 'ACTIONABLE')
    const allBlocked = targets.every((t) => t.actionability !== 'ACTIONABLE')
    const evidenceScopeStatus: TraceIdentitySourceEvidenceScopeStatus = allActionable
      ? 'ACTIONABLE'
      : allBlocked
        ? 'BLOCKED'
        : 'PARTIALLY_ACTIONABLE'

    const distinctScopes = new Set(sourceCandidates.map((c) => c.scope))
    const scope: TraceIdentitySourceEntry['scope'] = distinctScopes.size === 1 ? sourceCandidates[0].scope : 'mixed'

    const sourceProposals = proposalsByThreadId.get(sourceThreadId) ?? []
    const firstProposal = sourceProposals[0] ?? null
    const sourceExcerpt = firstProposal?.sourceExcerpt ?? null

    entries.push({
      sourceKey: sourceThreadId,
      sourceThreadId,
      sourceProposalIds: sourceProposals.map((p) => p.id),
      scope,
      sourceLabel: firstProposal?.label ?? null,
      sourceDocumentId: firstProposal?.documentId ?? null,
      sourceDocumentFilename: firstProposal?.documentFilename ?? null,
      sourceDocumentType: firstProposal?.documentType ?? null,
      sourceDocumentEffectiveDate: firstProposal?.documentEffectiveDate ?? null,
      sourcePage: firstProposal?.sourcePage ?? null,
      sourceExcerpt,
      hasVerbatimExcerpt: sourceExcerpt !== null,
      sourceDate: firstProposal?.createdAt ?? null,
      targets,
      targetCount: targets.length,
      evidenceScopeStatus,
      pendingTraceId: pendingTraceIdByThreadId.get(sourceThreadId) ?? null,
      needsFreeIdentityResolution: false,
    })
  }

  // Second passage FALLBACK (mandat Vincent) : une pending trace IDENTITY_UNRESOLVED encore
  // 'pending' en base dont la source n'a produit AUCUNE entrée ci-dessus (candidats tous rejetés/
  // consommés, ou jamais eu de candidat actionnable) ne doit jamais rester invisible. On ne
  // reconstruit rien depuis les candidats : seule la pending trace elle-même fait foi ici.
  const coveredThreadIds = new Set(entries.map((e) => e.sourceThreadId))
  for (const [sourceThreadId, pendingTraceId] of pendingTraceIdByThreadId) {
    if (coveredThreadIds.has(sourceThreadId)) continue

    const sourceProposals = proposalsByThreadId.get(sourceThreadId) ?? []
    const firstProposal = sourceProposals[0] ?? null
    const sourceExcerpt = firstProposal?.sourceExcerpt ?? null

    entries.push({
      sourceKey: sourceThreadId,
      sourceThreadId,
      sourceProposalIds: sourceProposals.map((p) => p.id),
      scope: 'thread',
      sourceLabel: firstProposal?.label ?? null,
      sourceDocumentId: firstProposal?.documentId ?? null,
      sourceDocumentFilename: firstProposal?.documentFilename ?? null,
      sourceDocumentType: firstProposal?.documentType ?? null,
      sourceDocumentEffectiveDate: firstProposal?.documentEffectiveDate ?? null,
      sourcePage: firstProposal?.sourcePage ?? null,
      sourceExcerpt,
      hasVerbatimExcerpt: sourceExcerpt !== null,
      sourceDate: firstProposal?.createdAt ?? null,
      targets: [],
      targetCount: 0,
      evidenceScopeStatus: 'BLOCKED',
      pendingTraceId,
      needsFreeIdentityResolution: true,
    })
  }

  const totalTargets = entries.reduce((sum, e) => sum + e.targets.length, 0)
  return { siteId, entries, totalSources: entries.length, totalTargets }
}

const NIL_UUID = '00000000-0000-0000-0000-000000000000'

export async function loadTraceIdentityQueue(siteId: string): Promise<TraceIdentityQueue> {
  const db = createAdminClient()

  const { data: rawPoints, error: pointsErr } = await db
    .from('tracked_point')
    .select('id, site_id, status, merged_into_id, founding_kind, founding_reference, created_at')
    .eq('site_id', siteId)
  if (pointsErr) throw pointsErr

  const points: TraceScopePointRow[] = (rawPoints ?? []).map((p) => ({
    id: p.id,
    siteId: p.site_id,
    status: p.status,
    mergedIntoId: p.merged_into_id,
    foundingKind: p.founding_kind,
    foundingReference: p.founding_reference,
    createdAt: p.created_at,
  }))
  const pointIds = points.map((p) => p.id)

  const { data: rawMembers, error: memErr } = await db
    .from('tracked_point_member')
    .select('tracked_point_id, subject_thread_id, scope, status, created_at')
    .in('tracked_point_id', pointIds.length > 0 ? pointIds : [NIL_UUID])
  if (memErr) throw memErr

  const members: TraceScopeMemberRow[] = (rawMembers ?? []).map((m) => ({
    trackedPointId: m.tracked_point_id,
    subjectThreadId: m.subject_thread_id,
    scope: (m.scope ?? 'thread') as TraceScopeMemberRow['scope'],
    status: m.status as TraceScopeMemberRow['status'],
    createdAt: m.created_at,
  }))

  const { data: rawCandidates, error: candErr } = await db
    .from('tracked_point_identity_candidate')
    .select('id, site_id, candidate_point_id, subject_thread_id, scope, status, created_at')
    .eq('site_id', siteId)
    .eq('status', 'pending')
  if (candErr) throw candErr

  const candidates: TraceScopeCandidateInput[] = (rawCandidates ?? []).map((c) => ({
    id: c.id,
    siteId: c.site_id,
    candidatePointId: c.candidate_point_id,
    subjectThreadId: c.subject_thread_id,
    scope: (c.scope ?? 'thread') as TraceScopeCandidateInput['scope'],
    createdAt: c.created_at,
  }))

  // Pending traces IDENTITY_UNRESOLVED encore ouvertes (mandat Vincent) : chargées INDÉPENDAMMENT
  // des candidats — c'est exactement ce qui permet de détecter une source dont plus aucun
  // candidat n'est actionnable alors que la trace, elle, reste 'pending' en base.
  const { data: rawPendingTraces, error: pendingErr } = await db
    .from('tracked_point_pending_trace')
    .select('id, source_thread_id')
    .eq('site_id', siteId)
    .eq('kind', 'IDENTITY_UNRESOLVED')
    .eq('status', 'pending')
  if (pendingErr) throw pendingErr

  const pendingTraceIdByThreadId = new Map<string, string>()
  for (const t of rawPendingTraces ?? []) {
    if (t.source_thread_id) pendingTraceIdByThreadId.set(t.source_thread_id, t.id)
  }

  const threadIds = [
    ...new Set([...candidates.map((c) => c.subjectThreadId), ...pendingTraceIdByThreadId.keys()]),
  ]

  const { data: rawProposals, error: propErr } = await db
    .from('document_extraction_proposal')
    .select('id, subject_thread_id, proposal_family, label, document_id, source_page, source_excerpt, created_at')
    .in('subject_thread_id', threadIds.length > 0 ? threadIds : [NIL_UUID])
  if (propErr) throw propErr

  const famillesByThreadId = new Map<string, string[]>()
  for (const p of rawProposals ?? []) {
    const list = famillesByThreadId.get(p.subject_thread_id) ?? []
    if (!list.includes(p.proposal_family)) list.push(p.proposal_family)
    famillesByThreadId.set(p.subject_thread_id, list)
  }

  const documentIds = [...new Set((rawProposals ?? []).map((p) => p.document_id).filter((id): id is string => !!id))]
  const { data: rawDocuments, error: docErr } = await db
    .from('documents')
    .select('id, filename, document_type, effective_date')
    .in('id', documentIds.length > 0 ? documentIds : [NIL_UUID])
  if (docErr) throw docErr
  const documentsById = new Map((rawDocuments ?? []).map((d) => [d.id, d]))

  const proposalsByThreadId = new Map<string, TraceIdentitySourceProposal[]>()
  for (const p of rawProposals ?? []) {
    const doc = p.document_id ? documentsById.get(p.document_id) : undefined
    const list = proposalsByThreadId.get(p.subject_thread_id) ?? []
    list.push({
      id: p.id,
      label: p.label,
      proposalFamily: p.proposal_family,
      documentId: p.document_id,
      documentFilename: doc?.filename ?? null,
      documentType: doc?.document_type ?? null,
      documentEffectiveDate: doc?.effective_date ?? null,
      sourcePage: p.source_page ?? null,
      sourceExcerpt: p.source_excerpt?.trim() || null,
      createdAt: p.created_at,
    })
    proposalsByThreadId.set(p.subject_thread_id, list)
  }

  const { points: pointReadModelEntries } = await loadTrackedPointReadModel(siteId)
  const pointDetailsById = new Map(pointReadModelEntries.map((p) => [p.id, p]))

  const targetSubjectIds = [
    ...new Set(pointReadModelEntries.map((p) => p.ownerCanonicalSubjectId).filter((id): id is string => !!id)),
  ]
  const subjectLabelBySubjectId = new Map<string, string | null>()
  if (targetSubjectIds.length > 0) {
    const { data: rawSubjects, error: subjErr } = await db
      .from('canonical_subject')
      .select('id, label')
      .in('id', targetSubjectIds)
    if (subjErr) throw subjErr
    for (const s of rawSubjects ?? []) subjectLabelBySubjectId.set(s.id, s.label)
  }

  return buildTraceIdentityQueue(
    siteId,
    candidates,
    points,
    members,
    famillesByThreadId,
    pointDetailsById,
    proposalsByThreadId,
    subjectLabelBySubjectId,
    pendingTraceIdByThreadId,
  )
}
