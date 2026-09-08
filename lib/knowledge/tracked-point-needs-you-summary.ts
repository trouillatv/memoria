// Phase 6E.4A — agrégateur "MemorIA a besoin de toi" (mandat Vincent : "la page ne doit pas
// être organisée autour des cinq primitives techniques ... le type de backend ne doit jamais
// devenir l'architecture visible de la page"). Ce module ne fait AUCUNE écriture, AUCUN LLM,
// AUCUNE nouvelle logique métier — il compose les 5 read-models déjà construits et gelés
// (tracked-point-consolidation-queue.ts, tracked-point-trace-queue.ts,
// tracked-point-pending-trackability-queue.ts, tracked-point-pending-resolution-queue.ts,
// tracked-point-evidence-scope-queue.ts) en une seule file de questions en langage métier.
//
// Même convention pure/async que les 5 modules composés : une fonction pure
// (buildMemoriaNeedsYouSummary, qui n'accepte que les 5 queues déjà chargées) + un chargeur
// async séparé (loadMemoriaNeedsYouSummary, qui les charge en parallèle puis délègue).
//
// Règle de non-double-comptage (evidence à préciser) : une pending trace dont l'evidence est
// encore unresolved apparaît dans DEUX des cinq queues sources — sa queue native
// (trackability/resolution), où elle reste visible mais actionable=false, ET dans
// loadEvidenceScopeQueue, où elle EST l'action à poser. Les deux read-models sources le disent
// déjà explicitement ("c'est alors la carte 6E.3C ... qui prend le relais, jamais celle-ci") :
// cet agrégateur ne matérialise donc JAMAIS de question 'confirm_trackability'/'assign_resolution'
// pour une entrée non actionnable — elle n'existe, pour l'humain, que sous 'clarify_evidence'.
// Aucune autre déduplication n'est nécessaire : duplicate_points et clarify_evidence n'ont pas
// cette notion de blocage amont, attach_information garde ses cibles bloquées visibles (aucune
// queue de "prise de relais" n'existe pour NEEDS_SCOPE_REFINEMENT/STALE_TARGET/TARGET_MISSING).

import { loadConsolidationQueue, type ConsolidationQueue, type ConsolidationQueueEntry } from './tracked-point-consolidation-queue'
import { loadTraceIdentityQueue, type TraceIdentityQueue, type TraceIdentitySourceEntry } from './tracked-point-trace-queue'
import {
  loadPendingTrackabilityQueue,
  type PendingTrackabilityQueue,
  type PendingTrackabilityQueueEntry,
} from './tracked-point-pending-trackability-queue'
import {
  loadPendingResolutionQueue,
  type PendingResolutionQueue,
  type PendingResolutionQueueEntry,
} from './tracked-point-pending-resolution-queue'
import { loadEvidenceScopeQueue, type EvidenceScopeQueue, type EvidenceScopeQueueEntry } from './tracked-point-evidence-scope-queue'
import {
  MEMORIA_NEEDS_YOU_CATEGORY_ORDER,
  MEMORIA_NEEDS_YOU_CATEGORY_LABELS,
  type MemoriaNeedsYouCategory,
} from './tracked-point-needs-you-categories'

// Catégories/libellés déplacés dans tracked-point-needs-you-categories.ts (module sans
// dépendance 'server-only', importable tel quel par les composants client de la page) —
// ré-exportés ici pour les consommateurs serveur existants.
export { MEMORIA_NEEDS_YOU_CATEGORY_ORDER, MEMORIA_NEEDS_YOU_CATEGORY_LABELS }
export type { MemoriaNeedsYouCategory }

export type MemoriaNeedsYouQuestion =
  | { category: 'duplicate_points'; id: string; entry: ConsolidationQueueEntry }
  | { category: 'attach_information'; id: string; entry: TraceIdentitySourceEntry }
  | { category: 'confirm_trackability'; id: string; entry: PendingTrackabilityQueueEntry }
  | { category: 'assign_resolution'; id: string; entry: PendingResolutionQueueEntry }
  | { category: 'clarify_evidence'; id: string; entry: EvidenceScopeQueueEntry }

export type MemoriaNeedsYouCategorySummary = {
  category: MemoriaNeedsYouCategory
  label: string
  count: number
}

export type MemoriaNeedsYouSummary = {
  siteId: string
  totalCount: number
  categories: MemoriaNeedsYouCategorySummary[]
  questions: MemoriaNeedsYouQuestion[]
}

// buildMemoriaNeedsYouSummary : pur. N'accepte que les 5 queues déjà chargées par l'appelant —
// aucun accès DB ici, aucune logique de sélection dupliquée depuis les read-models sources.
export function buildMemoriaNeedsYouSummary(
  siteId: string,
  consolidation: ConsolidationQueue,
  traceIdentity: TraceIdentityQueue,
  trackability: PendingTrackabilityQueue,
  resolution: PendingResolutionQueue,
  evidenceScope: EvidenceScopeQueue,
): MemoriaNeedsYouSummary {
  const questions: MemoriaNeedsYouQuestion[] = [
    ...consolidation.entries.map((entry): MemoriaNeedsYouQuestion => ({ category: 'duplicate_points', id: entry.pairId, entry })),
    ...traceIdentity.entries.map((entry): MemoriaNeedsYouQuestion => ({ category: 'attach_information', id: entry.sourceKey, entry })),
    ...trackability.entries
      .filter((entry) => entry.actionable)
      .map((entry): MemoriaNeedsYouQuestion => ({ category: 'confirm_trackability', id: entry.pendingTraceId, entry })),
    ...resolution.entries
      .filter((entry) => entry.actionable)
      .map((entry): MemoriaNeedsYouQuestion => ({ category: 'assign_resolution', id: entry.pendingTraceId, entry })),
    ...evidenceScope.entries.map((entry): MemoriaNeedsYouQuestion => ({ category: 'clarify_evidence', id: entry.pendingTraceId, entry })),
  ]

  const categories: MemoriaNeedsYouCategorySummary[] = MEMORIA_NEEDS_YOU_CATEGORY_ORDER.map((category) => ({
    category,
    label: MEMORIA_NEEDS_YOU_CATEGORY_LABELS[category],
    count: questions.filter((q) => q.category === category).length,
  }))

  return { siteId, totalCount: questions.length, categories, questions }
}

export async function loadMemoriaNeedsYouSummary(siteId: string): Promise<MemoriaNeedsYouSummary> {
  const [consolidation, traceIdentity, trackability, resolution, evidenceScope] = await Promise.all([
    loadConsolidationQueue(siteId),
    loadTraceIdentityQueue(siteId),
    loadPendingTrackabilityQueue(siteId),
    loadPendingResolutionQueue(siteId),
    loadEvidenceScopeQueue(siteId),
  ])

  return buildMemoriaNeedsYouSummary(siteId, consolidation, traceIdentity, trackability, resolution, evidenceScope)
}
