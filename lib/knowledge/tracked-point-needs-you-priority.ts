// 6E.4A.4 — priorité réelle, calculée à partir de signaux déjà exposés par les 5 read-models
// (aucun LLM, aucun score additionné, aucune donnée inventée). Deux signaux existent réellement
// aujourd'hui sans migration : l'état dérivé d'un Point touché (`derivedState` reopened/conflict,
// déjà exposé par tracked-point-read-model.ts) et l'ambiguïté structurelle de la question
// (plusieurs cibles possibles / composante de consolidation à plus de 2 Points, déjà portée par
// chaque read-model).
//
// DOCTRINE (Vincent, retour post-c00b3cfd) : « Récent ≠ important, Historique ≠ faible
// importance ». La fraîcheur de la date métier N'EST PAS un signal d'importance — elle reste
// exclusivement un axe de tri/filtre (Période, Trier par dans NeedsYouClient.tsx), jamais un
// critère de priorité. Le palier IMPORTANT reste dans le type pour les deux signaux du mandat
// initial encore HORS PÉRIMÈTRE faute de champ existant — échéance contractuelle (aucune colonne
// d'échéance jointe à ces read-models) et non-conformité (aucun champ ne l'encode) — mais
// computeQuestionPriority() ne le retourne jamais tant que ces signaux ne sont pas câblés : un
// palier vide plutôt qu'un palier simulé par la date. Un sujet ancien mais toujours ouvert
// (reopened/conflict) reste PRIORITAIRE indéfiniment ; un document importé hier sans autre signal
// reste HISTORIQUE.
//
// Ordre d'évaluation, premier signal qui matche gagne (jamais un score additionné) :
//   1. PRIORITAIRE — la question touche un Point reopened/conflict : un problème redevenu actif
//      ou en contradiction documentaire attend une décision.
//   2. À CLARIFIER — la question est structurellement ambiguë (plusieurs cibles possibles, ou
//      composante de consolidation à plus de 2 Points) : trancher entre options avant association.
//   3. HISTORIQUE — le reste : rien ne distingue une urgence particulière aujourd'hui.

import type { MemoriaNeedsYouQuestion } from './tracked-point-needs-you-summary'

export type MemoriaNeedsYouPriority = 'PRIORITAIRE' | 'A_CLARIFIER' | 'IMPORTANT' | 'HISTORIQUE'

export const MEMORIA_NEEDS_YOU_PRIORITY_ORDER: MemoriaNeedsYouPriority[] = ['PRIORITAIRE', 'A_CLARIFIER', 'IMPORTANT', 'HISTORIQUE']

export const MEMORIA_NEEDS_YOU_PRIORITY_LABEL: Record<MemoriaNeedsYouPriority, string> = {
  PRIORITAIRE: 'Prioritaire',
  A_CLARIFIER: 'À clarifier',
  IMPORTANT: 'Important',
  HISTORIQUE: 'Historique',
}

function isActiveDerivedState(state: string | null | undefined): boolean {
  return state === 'reopened' || state === 'conflict'
}

function touchesActivePoint(question: MemoriaNeedsYouQuestion): boolean {
  switch (question.category) {
    case 'duplicate_points':
      return isActiveDerivedState(question.entry.pointA.derivedState) || isActiveDerivedState(question.entry.pointB.derivedState)
    case 'attach_information':
      return question.entry.targets.some((t) => isActiveDerivedState(t.derivedState))
    case 'assign_resolution':
      return (
        question.entry.knownIdentityTargets.some((t) => isActiveDerivedState(t.derivedState)) ||
        question.entry.sameSubjectSuggestions.some((t) => isActiveDerivedState(t.derivedState))
      )
    case 'confirm_trackability':
    case 'clarify_evidence':
    default:
      return false
  }
}

function isStructurallyAmbiguous(question: MemoriaNeedsYouQuestion): boolean {
  switch (question.category) {
    case 'duplicate_points':
      return question.entry.componentSize > 2
    case 'attach_information':
      return question.entry.targetCount > 1
    case 'assign_resolution':
      return (
        question.entry.targetingMode === 'SEARCH_REQUIRED' ||
        question.entry.targetingMode === 'KNOWN_MULTI' ||
        question.entry.targetingMode === 'SUBJECT_MULTI'
      )
    case 'confirm_trackability':
    case 'clarify_evidence':
    default:
      return false
  }
}

// computeQuestionPriority : pur, sans horloge — la date métier n'est plus un signal de priorité
// (voir doctrine ci-dessus), donc plus besoin de nowMs. Les appelants qui datent encore la
// fraîcheur le font via questionDate()/Trier par (NeedsYouClient.tsx), un axe séparé.
export function computeQuestionPriority(question: MemoriaNeedsYouQuestion): MemoriaNeedsYouPriority {
  if (touchesActivePoint(question)) return 'PRIORITAIRE'
  if (isStructurallyAmbiguous(question)) return 'A_CLARIFIER'
  return 'HISTORIQUE'
}
