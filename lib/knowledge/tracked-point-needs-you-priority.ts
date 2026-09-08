// 6E.4A.4 — priorité réelle, calculée à partir de signaux déjà exposés par les 5 read-models
// (aucun LLM, aucun score additionné, aucune donnée inventée). Trois signaux existent réellement
// aujourd'hui sans migration : l'état dérivé d'un Point touché (`derivedState` reopened/conflict/
// open/unknown, déjà exposé par tracked-point-read-model.ts) et l'ambiguïté structurelle de la
// question (plusieurs cibles possibles / composante de consolidation à plus de 2 Points, déjà
// portée par chaque read-model).
//
// DOCTRINE (Vincent, GO post-audit 6E.4A-Priority) : « Récent ≠ important, Historique ≠ faible
// importance ». La fraîcheur de la date métier N'EST PAS un signal d'importance — elle reste
// exclusivement un axe de tri/filtre (Période, Trier par dans NeedsYouClient.tsx), jamais un
// critère de priorité. Un Point ouvert (open) représente une situation encore vivante du chantier :
// modifier son identité, y rattacher une preuve ou lui attribuer une résolution n'est pas du simple
// nettoyage historique, mais open est trop fréquent pour signifier urgence — d'où IMPORTANT et non
// PRIORITAIRE. Un Point unknown signifie surtout « état insuffisamment établi » : il rejoint
// À_CLARIFIER, pas IMPORTANT. Échéance contractuelle et non-conformité restent HORS PÉRIMÈTRE
// (aucun champ joint à ces read-models) — différées à 6E.4B-Priority Context, non câblées ici. Un
// sujet ancien mais toujours ouvert (reopened/conflict) reste PRIORITAIRE indéfiniment ; un
// document importé hier sans autre signal reste HISTORIQUE.
//
// Ordre d'évaluation, premier signal qui matche gagne (jamais un score additionné) :
//   1. PRIORITAIRE — la question touche un Point reopened/conflict : un problème redevenu actif
//      ou en contradiction documentaire attend une décision.
//   2. IMPORTANT — la question touche directement un Point open : une situation encore vivante du
//      chantier, même sans ambiguïté ni contradiction. Prime sur l'ambiguïté structurelle : une
//      question à la fois open et ambiguë reste IMPORTANT (l'impact métier passe avant la
//      difficulté technique de la décision).
//   3. À CLARIFIER — la question touche un Point unknown, ou est structurellement ambiguë
//      (plusieurs cibles possibles, ou composante de consolidation à plus de 2 Points) : état
//      insuffisamment établi ou choix à trancher avant association.
//   4. HISTORIQUE — le reste : rien ne distingue une urgence particulière aujourd'hui.

import type { MemoriaNeedsYouQuestion } from './tracked-point-needs-you-summary'

export type MemoriaNeedsYouPriority = 'PRIORITAIRE' | 'A_CLARIFIER' | 'IMPORTANT' | 'HISTORIQUE'

export const MEMORIA_NEEDS_YOU_PRIORITY_ORDER: MemoriaNeedsYouPriority[] = ['PRIORITAIRE', 'IMPORTANT', 'A_CLARIFIER', 'HISTORIQUE']

export const MEMORIA_NEEDS_YOU_PRIORITY_LABEL: Record<MemoriaNeedsYouPriority, string> = {
  PRIORITAIRE: 'Prioritaire',
  A_CLARIFIER: 'À clarifier',
  IMPORTANT: 'Important',
  HISTORIQUE: 'Historique',
}

function isActiveDerivedState(state: string | null | undefined): boolean {
  return state === 'reopened' || state === 'conflict'
}

function isOpenDerivedState(state: string | null | undefined): boolean {
  return state === 'open'
}

function isUnknownDerivedState(state: string | null | undefined): boolean {
  return state === 'unknown'
}

function touchesDerivedState(question: MemoriaNeedsYouQuestion, matches: (state: string | null | undefined) => boolean): boolean {
  switch (question.category) {
    case 'duplicate_points':
      return matches(question.entry.pointA.derivedState) || matches(question.entry.pointB.derivedState)
    case 'attach_information':
      return question.entry.targets.some((t) => matches(t.derivedState))
    case 'assign_resolution':
      return (
        question.entry.knownIdentityTargets.some((t) => matches(t.derivedState)) ||
        question.entry.sameSubjectSuggestions.some((t) => matches(t.derivedState))
      )
    case 'confirm_trackability':
    case 'clarify_evidence':
    default:
      return false
  }
}

function touchesActivePoint(question: MemoriaNeedsYouQuestion): boolean {
  return touchesDerivedState(question, isActiveDerivedState)
}

function touchesOpenPoint(question: MemoriaNeedsYouQuestion): boolean {
  return touchesDerivedState(question, isOpenDerivedState)
}

function touchesUnknownPoint(question: MemoriaNeedsYouQuestion): boolean {
  return touchesDerivedState(question, isUnknownDerivedState)
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
  if (touchesOpenPoint(question)) return 'IMPORTANT'
  if (touchesUnknownPoint(question) || isStructurallyAmbiguous(question)) return 'A_CLARIFIER'
  return 'HISTORIQUE'
}
