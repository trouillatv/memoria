// 6E.4A.4 — priorité réelle, calculée à partir de signaux déjà exposés par les 5 read-models
// (aucun LLM, aucun score additionné, aucune donnée inventée). Trois signaux existent
// réellement aujourd'hui sans migration : l'état dérivé d'un Point touché (`derivedState`
// reopened/conflict, déjà exposé par tracked-point-read-model.ts), l'ambiguïté structurelle de
// la question (plusieurs cibles possibles / composante de consolidation à plus de 2 Points, déjà
// portée par chaque read-model), et la fraîcheur de la date métier (déjà câblée en 6E.4A.1). Deux
// signaux du mandat initial restent HORS PÉRIMÈTRE faute de champ existant — échéance
// contractuelle (aucune colonne d'échéance jointe à ces read-models) et non-conformité (aucun
// champ ne l'encode) — ni l'un ni l'autre n'est simulé.
//
// Ordre d'évaluation, premier signal qui matche gagne (jamais un score additionné) :
//   1. PRIORITAIRE — la question touche un Point reopened/conflict : un problème redevenu actif
//      ou en contradiction documentaire attend une décision.
//   2. À CLARIFIER — la question est structurellement ambiguë (plusieurs cibles possibles, ou
//      composante de consolidation à plus de 2 Points) : trancher entre options avant association.
//   3. IMPORTANT — la source est récente (date métier < 30 jours) : information encore fraîche.
//   4. HISTORIQUE — le reste : rien ne distingue une urgence particulière.

import type { MemoriaNeedsYouQuestion } from './tracked-point-needs-you-summary'

export type MemoriaNeedsYouPriority = 'PRIORITAIRE' | 'A_CLARIFIER' | 'IMPORTANT' | 'HISTORIQUE'

export const MEMORIA_NEEDS_YOU_PRIORITY_ORDER: MemoriaNeedsYouPriority[] = ['PRIORITAIRE', 'A_CLARIFIER', 'IMPORTANT', 'HISTORIQUE']

export const MEMORIA_NEEDS_YOU_PRIORITY_LABEL: Record<MemoriaNeedsYouPriority, string> = {
  PRIORITAIRE: 'Prioritaire',
  A_CLARIFIER: 'À clarifier',
  IMPORTANT: 'Important',
  HISTORIQUE: 'Historique',
}

const RECENT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

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

// businessDateOf : même règle 6E.4A.1 que questionDate() dans NeedsYouClient.tsx (date métier
// prioritaire, date d'import en repli) — dupliquée volontairement en un one-liner par branche
// plutôt qu'importée depuis le composant client, ce module restant sans dépendance UI.
function businessDateOf(question: MemoriaNeedsYouQuestion): string | null {
  switch (question.category) {
    case 'attach_information':
    case 'confirm_trackability':
    case 'assign_resolution':
      return question.entry.sourceDocumentEffectiveDate ?? question.entry.sourceDate ?? null
    case 'clarify_evidence': {
      const firstProposal = question.entry.proposals[0] ?? null
      return firstProposal?.documentEffectiveDate ?? firstProposal?.createdAt ?? question.entry.createdAt ?? null
    }
    case 'duplicate_points':
    default:
      return null
  }
}

function isRecent(question: MemoriaNeedsYouQuestion, nowMs: number): boolean {
  const date = businessDateOf(question)
  if (!date) return false
  const parsed = Date.parse(date)
  if (Number.isNaN(parsed)) return false
  return nowMs - parsed <= RECENT_WINDOW_MS
}

// computeQuestionPriority : pur (nowMs injecté par l'appelant, jamais Date.now() interne).
export function computeQuestionPriority(question: MemoriaNeedsYouQuestion, nowMs: number): MemoriaNeedsYouPriority {
  if (touchesActivePoint(question)) return 'PRIORITAIRE'
  if (isStructurallyAmbiguous(question)) return 'A_CLARIFIER'
  if (isRecent(question, nowMs)) return 'IMPORTANT'
  return 'HISTORIQUE'
}
