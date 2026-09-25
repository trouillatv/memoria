import 'server-only'

// ── SUIVI-1 — Visibilité des sorties de visite ──────────────────────────────
// Read model STRICTEMENT LECTURE : ce qu'une visite native a produit, ce qui en
// est resté en attente, ce qui n'a jamais été rattaché, ce qui s'est matérialisé
// en sujet canonique. Aucune écriture, aucun seuil de réconciliation touché,
// aucune Action/Point créé par le rendu.
//
// Jointures réelles (auditées sur le témoin Sextant, jamais supposées) :
//   · site_knowledge_proposals.canonical_subject_id / canonical_resolution_status
//     portent DIRECTEMENT le verdict de réconciliation (mig canonical-subject-
//     source-reconcile) — 'resolved' = matérialisé, 'not_found' = orphelin,
//     null = kind non-éligible (stakeholder) ou jamais tenté.
//   · tracked_point_pending_trace.source_thread_id = canonical_subject_id RACINE
//     pour les traces issues d'une visite native (cf.
//     tracked-point-live-writer-native-adapter.ts) — PAS subject_thread_identity.
//     On rattache une trace à CETTE visite via les canonical_subject_id que ses
//     propositions ont résolus, jamais par simple site_id (qui mélangerait les
//     traces d'autres visites/sujets du même chantier).
//   · L'acteur non résolu vit dans site_reports.debrief_analysis.semantic_memory
//     .resolutions[rawText] — mécanisme séparé de la réconciliation canonique
//     (les propositions 'stakeholder' ne tentent jamais cette dernière).
//   · L'indexation mémoire se lit sur knowledge_chunks.source_id = report_id.

import { createAdminClient } from '@/lib/supabase/admin'
import {
  listProposalsByReport,
  getCanonicalSubjectLabels,
  type DbKnowledgeProposal,
  type ProposalKind,
  type ProposalStatus,
} from '@/lib/db/knowledge-proposals'
import { pendingTraceVisibleFilter } from '@/lib/db/tracked-point-pending-resolution'
import type { StoredDebriefAnalysis } from '@/lib/visits/debrief-analysis'
import type { EntityResolution } from '@/lib/knowledge/semantic-resolution'
import type { SiteReportStatus } from '@/types/db'

const NIL_UUID = '00000000-0000-0000-0000-000000000000'

export type VisitOutcomeSourceRef = {
  id: string
  type: 'proposal' | 'canonical_subject' | 'pending_trace' | 'actor'
}

export interface VisitOutcomeProposal {
  ref: VisitOutcomeSourceRef
  kind: ProposalKind
  status: ProposalStatus
  title: string
  canonicalSubjectId: string | null
  canonicalSubjectLabel: string | null
  canonicalResolutionStatus: string | null
}

export interface VisitOutcomePendingTrace {
  ref: VisitOutcomeSourceRef
  reason: string | null
  evidenceStatus: string
  createdAt: string | null
  canonicalSubjectId: string
  canonicalSubjectLabel: string | null
}

export interface VisitOutcomeUnresolvedActor {
  ref: VisitOutcomeSourceRef
  rawText: string
}

export interface VisitOutcomeSummary {
  visitId: string
  siteId: string
  crStatus: SiteReportStatus
  produced: { proposals: VisitOutcomeProposal[] }
  materialized: { proposals: VisitOutcomeProposal[] }
  pending: { traces: VisitOutcomePendingTrace[] }
  unresolved: {
    orphanedProposals: VisitOutcomeProposal[]
    actors: VisitOutcomeUnresolvedActor[]
  }
  memoryIndexed: boolean
}

type PendingTraceRow = {
  id: string
  sourceThreadId: string
  reason: string | null
  createdAt: string | null
  evidenceStatus: string
}

/**
 * Assemblage pur : ne décide rien, relie ce que les tables savent déjà.
 * Séparée de l'accès DB pour rester testable sans Supabase.
 */
export function buildVisitOutcomeSummary(params: {
  visitId: string
  siteId: string
  crStatus: SiteReportStatus
  proposals: DbKnowledgeProposal[]
  pendingTraces: PendingTraceRow[]
  subjectLabelsById: Map<string, string>
  actorResolutions: Record<string, EntityResolution>
  memoryIndexed: boolean
}): VisitOutcomeSummary {
  const { visitId, siteId, crStatus, proposals, pendingTraces, subjectLabelsById, actorResolutions, memoryIndexed } = params

  const toProposal = (p: DbKnowledgeProposal): VisitOutcomeProposal => ({
    ref: { id: p.id, type: 'proposal' },
    kind: p.kind,
    status: p.status,
    title: p.title,
    canonicalSubjectId: p.canonical_subject_id,
    canonicalSubjectLabel: p.canonical_subject_id ? (subjectLabelsById.get(p.canonical_subject_id) ?? null) : null,
    canonicalResolutionStatus: p.canonical_resolution_status,
  })

  const producedProposals = proposals.map(toProposal)
  const materializedProposals = producedProposals.filter((p) => p.canonicalResolutionStatus === 'resolved')
  const orphanedProposals = producedProposals.filter((p) => p.canonicalResolutionStatus === 'not_found')

  const traces: VisitOutcomePendingTrace[] = pendingTraces.map((t) => ({
    ref: { id: t.id, type: 'pending_trace' },
    reason: t.reason,
    evidenceStatus: t.evidenceStatus,
    createdAt: t.createdAt,
    canonicalSubjectId: t.sourceThreadId,
    canonicalSubjectLabel: subjectLabelsById.get(t.sourceThreadId) ?? null,
  }))

  const actors: VisitOutcomeUnresolvedActor[] = Object.entries(actorResolutions)
    .filter(([, r]) => r.needs_resolution)
    .map(([rawText]) => ({ ref: { id: rawText, type: 'actor' }, rawText }))

  return {
    visitId,
    siteId,
    crStatus,
    produced: { proposals: producedProposals },
    materialized: { proposals: materializedProposals },
    pending: { traces },
    unresolved: { orphanedProposals, actors },
    memoryIndexed,
  }
}

/**
 * Charge et assemble le résumé des sorties d'UNE visite native. Résilient :
 * une brique absente (propositions, traces, labels, chunks) ne fait pas
 * échouer tout l'écran — elle retombe sur une liste vide / false.
 */
export async function getVisitOutcomeSummary(visitId: string): Promise<VisitOutcomeSummary | null> {
  const supabase = createAdminClient()

  const { data: reportRow, error: reportErr } = await supabase
    .from('site_reports')
    .select('id, site_id, status, debrief_analysis')
    .eq('id', visitId)
    .maybeSingle()
  if (reportErr) throw reportErr
  if (!reportRow) return null

  const siteId = reportRow.site_id as string
  const crStatus = reportRow.status as SiteReportStatus
  const analysis = reportRow.debrief_analysis as StoredDebriefAnalysis | null
  const actorResolutions = analysis?.semantic_memory?.resolutions ?? {}

  const proposals = await listProposalsByReport(visitId).catch(() => [])

  const candidateSubjectIds = [
    ...new Set(proposals.map((p) => p.canonical_subject_id).filter((id): id is string => !!id)),
  ]

  const { data: rawTraces, error: tracesErr } = await supabase
    .from('tracked_point_pending_trace')
    .select('id, source_thread_id, reason, created_at, evidence_status')
    .eq('site_id', siteId)
    .eq('status', 'pending')
    .in('source_thread_id', candidateSubjectIds.length > 0 ? candidateSubjectIds : [NIL_UUID])
    .or(pendingTraceVisibleFilter(new Date().toISOString()))
  if (tracesErr) throw tracesErr

  const pendingTraces: PendingTraceRow[] = (rawTraces ?? []).map((t) => ({
    id: t.id,
    sourceThreadId: t.source_thread_id,
    reason: t.reason,
    createdAt: t.created_at,
    evidenceStatus: t.evidence_status,
  }))

  const subjectIdsForLabels = [...new Set([...candidateSubjectIds, ...pendingTraces.map((t) => t.sourceThreadId)])]
  const subjectLabelsById = await getCanonicalSubjectLabels(subjectIdsForLabels).catch(() => new Map<string, string>())

  const { count: chunkCount } = await supabase
    .from('knowledge_chunks')
    .select('id', { count: 'exact', head: true })
    .eq('source_id', visitId)
  const memoryIndexed = (chunkCount ?? 0) > 0

  return buildVisitOutcomeSummary({
    visitId,
    siteId,
    crStatus,
    proposals,
    pendingTraces,
    subjectLabelsById,
    actorResolutions,
    memoryIndexed,
  })
}
