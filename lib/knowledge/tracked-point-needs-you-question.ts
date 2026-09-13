// Extrait de tracked-point-needs-you-summary.ts (fix build) — même raison que
// tracked-point-needs-you-categories.ts : module sans dépendance 'server-only', importable tel
// quel par les composants client de la page (NeedsYouClient.tsx). tracked-point-needs-you-summary.ts
// importe en VALEUR les 5 loaders de queues (loadConsolidationQueue, etc.), qui remontent à
// lib/supabase/admin.ts ('server-only') — même un import de type mélangé à un import de valeur
// dans le même fichier poison tout le fichier pour le bundle client. Les fonctions ci-dessous sont
// pures (aucun accès DB) : seuls des `import type` vers les modules de queues sont nécessaires
// (types effacés à la compilation, jamais de contamination runtime).

import type { ConsolidationQueueEntry } from './tracked-point-consolidation-queue'
import type { TraceIdentitySourceEntry } from './tracked-point-trace-queue'
import type { PendingTrackabilityQueueEntry } from './tracked-point-pending-trackability-queue'
import type { PendingResolutionQueueEntry } from './tracked-point-pending-resolution-queue'
import type { EvidenceScopeQueueEntry } from './tracked-point-evidence-scope-queue'
import type { MemoriaNeedsYouCategory } from './tracked-point-needs-you-categories'

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

// Lot UX Point 1.1 (mandat Vincent) — NeedsYou contextuel À l'échelle d'UN Sujet. Contrairement au
// filtre Point ci-dessus, aucune des 5 catégories n'est exclue ici : les 5 read-models sources
// portent chacun une référence sujet vérifiée (ConsolidationQueuePointSide.subjectId,
// TraceIdentityTarget.subject, PendingTrackabilityQueueEntry.subjectId,
// PendingResolution{Known,SameSubject}Target.subjectId, EvidenceScopeQueueEntry.subjectId) —
// exclure confirm_trackability/clarify_evidence comme au niveau Point serait ici un oubli, pas une
// honnêteté : elles portent réellement un subjectId.
export function filterMemoriaNeedsYouQuestionsForSubject(
  questions: MemoriaNeedsYouQuestion[],
  subjectId: string,
): MemoriaNeedsYouQuestion[] {
  return questions.filter((q) => {
    switch (q.category) {
      case 'duplicate_points':
        return q.entry.pointA.subjectId === subjectId || q.entry.pointB.subjectId === subjectId
      case 'attach_information':
        return q.entry.targets.some((t) => t.subject === subjectId)
      case 'confirm_trackability':
        return q.entry.subjectId === subjectId
      case 'clarify_evidence':
        return q.entry.subjectId === subjectId
      case 'assign_resolution':
        return q.entry.knownIdentityTargets.some((t) => t.subjectId === subjectId)
          || q.entry.sameSubjectSuggestions.some((t) => t.subjectId === subjectId)
    }
  })
}

// Point concerné par une question NeedsYou, à l'échelle d'un Sujet — "aucune heuristique de
// rattachement" (mandat) : ne retourne un Point que lorsqu'un SEUL Point distinct du sujet est
// candidat pour cette question précise. Deux Points candidats distincts (ex. duplicate_points où
// pointA ET pointB appartiennent au sujet, ou une résolution encore ambiguë entre plusieurs
// suggestions) → null, jamais un choix arbitraire. confirm_trackability/clarify_evidence n'ont
// structurellement aucune référence Point dans leur source (seulement Sujet) → toujours null.
export function resolveMemoriaNeedsYouSubjectPointRef(
  question: MemoriaNeedsYouQuestion,
  subjectId: string,
): { pointId: string; pointLabel: string | null } | null {
  let candidates: { pointId: string; pointLabel: string | null }[]
  switch (question.category) {
    case 'duplicate_points':
      candidates = [question.entry.pointA, question.entry.pointB]
        .filter((p) => p.subjectId === subjectId)
        .map((p) => ({ pointId: p.id, pointLabel: p.label }))
      break
    case 'attach_information':
      candidates = question.entry.targets
        .filter((t) => t.subject === subjectId)
        .map((t) => ({ pointId: t.pointId, pointLabel: t.label }))
      break
    case 'assign_resolution':
      candidates = [...question.entry.knownIdentityTargets, ...question.entry.sameSubjectSuggestions]
        .filter((t) => t.subjectId === subjectId)
        .map((t) => ({ pointId: t.pointId, pointLabel: t.label }))
      break
    case 'confirm_trackability':
    case 'clarify_evidence':
      return null
  }
  const distinctPointIds = new Set(candidates.map((c) => c.pointId))
  if (distinctPointIds.size !== 1) return null
  return candidates[0]
}

// Lot UX Point 1.1 (mandat Vincent) — deep-link vers UNE question précise de la boîte "MemorIA a
// besoin de toi" : `id` est le même identifiant stable que celui déjà porté par
// MemoriaNeedsYouQuestion (pairId/sourceKey/pendingTraceId selon la catégorie), lu côté client par
// NeedsYouClient (`?q=<id>`) pour ouvrir le bon filtre catégorie, révéler la carte au-delà de la
// pagination et y scroller — sans nouveau schéma ni nouvelle route. Seule porte honnête vers "la"
// question concernée : n'est utilisée par les blocs contextuels (Point/Sujet) que lorsqu'une seule
// question est identifiable, jamais pour deviner laquelle parmi plusieurs.
export function needsYouQuestionHref(baseHref: string, questionId: string): string {
  return `${baseHref}${baseHref.includes('?') ? '&' : '?'}q=${encodeURIComponent(questionId)}`
}
