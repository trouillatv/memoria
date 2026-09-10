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
  // 6E.4A.5 — split "dernier PV / historique" pour la bannière Aperçu (jamais un total brut).
  // latestPvDate = date métier (jour, sans heure) la plus récente parmi les questions datées ;
  // null si aucune question de la file n'a de date métier (ex. file uniquement duplicate_points).
  latestPvDate: string | null
  latestPvCount: number
  historicalCount: number
}

// businessDateOnlyOf : même règle 6E.4A.1 que questionDate() (NeedsYouClient.tsx) et
// businessDateOf() (tracked-point-needs-you-priority.ts) — date métier prioritaire, date d'import
// en repli, dupliquée volontairement (convention déjà établie : chaque module reste sans
// dépendance croisée). Tronquée au jour (YYYY-MM-DD) : deux questions du même PV mais insérées à
// des instants différents doivent compter comme le même "dernier PV".
function businessDateOnlyOf(question: MemoriaNeedsYouQuestion): string | null {
  let date: string | null
  switch (question.category) {
    case 'attach_information':
    case 'confirm_trackability':
    case 'assign_resolution':
      date = question.entry.sourceDocumentEffectiveDate ?? question.entry.sourceDate ?? null
      break
    case 'clarify_evidence': {
      const firstProposal = question.entry.proposals[0] ?? null
      date = firstProposal?.documentEffectiveDate ?? firstProposal?.createdAt ?? question.entry.createdAt ?? null
      break
    }
    case 'duplicate_points':
    default:
      date = null
  }
  if (!date) return null
  const parsed = Date.parse(date)
  if (Number.isNaN(parsed)) return null
  return new Date(parsed).toISOString().slice(0, 10)
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

  const dates = questions.map(businessDateOnlyOf).filter((d): d is string => d !== null)
  const latestPvDate = dates.length > 0 ? dates.reduce((max, d) => (d > max ? d : max)) : null
  const latestPvCount = latestPvDate ? questions.filter((q) => businessDateOnlyOf(q) === latestPvDate).length : 0

  return {
    siteId,
    totalCount: questions.length,
    categories,
    questions,
    latestPvDate,
    latestPvCount,
    historicalCount: questions.length - latestPvCount,
  }
}

// Lot UX Point 3F (mandat Vincent) — NeedsYou contextuel À l'échelle d'UN Point : seules les
// catégories dont la donnée référence RÉELLEMENT ce Point qualifient. confirm_trackability et
// clarify_evidence n'ont AUCUNE référence Point dans leur source (vérifié : zéro `pointId` dans
// tracked-point-pending-trackability-queue.ts et tracked-point-evidence-scope-queue.ts) — les
// exclure ici n'est pas un oubli, c'est la seule contextualisation honnête possible pour elles ;
// elles restent visibles au niveau Sujet/global (MemoriaNeedsYouBlock), jamais ici.
export function filterMemoriaNeedsYouQuestionsForPoint(
  questions: MemoriaNeedsYouQuestion[],
  pointId: string,
): MemoriaNeedsYouQuestion[] {
  return questions.filter((q) => {
    switch (q.category) {
      case 'duplicate_points':
        return q.entry.pointA.id === pointId || q.entry.pointB.id === pointId
      case 'attach_information':
        return q.entry.targets.some((t) => t.pointId === pointId)
      case 'assign_resolution':
        return q.entry.knownIdentityTargets.some((t) => t.pointId === pointId)
          || q.entry.sameSubjectSuggestions.some((t) => t.pointId === pointId)
      case 'confirm_trackability':
      case 'clarify_evidence':
        return false
    }
  })
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
