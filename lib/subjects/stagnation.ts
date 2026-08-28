/**
 * #228 Lot B — Éligibilité à la STAGNATION (pur, testable).
 *
 * Doctrine produit (3 notions distinctes) :
 *   open       = « pas résolu ».
 *   reopened / objet opérationnel ouvert = « une évolution est ATTENDUE ».
 *   stagnant   = « une évolution était attendue mais n'arrive pas depuis assez longtemps ».
 *
 * Un sujet n'est éligible à la stagnation QUE si :
 *   1. c'est un sujet métier durable (durableKind ≠ actor) ;
 *   2. quelque chose indique concrètement qu'une évolution est attendue :
 *        objet opérationnel ouvert (action/réserve/deadline/décision) OU réouverture.
 * L'état `open` SEUL ne suffit pas (open = pas résolu, pas « évolution attendue »).
 * La famille de l'occurrence (dominantFamily) ne décide JAMAIS de la stagnation.
 *
 * Les conditions TEMPORELLES (!closed && stagnationDays>=30 && consecutiveMentions>=2) restent
 * gérées par l'appelant et sont INCHANGÉES par ce lot.
 */

export function isStagnationEligible(
  durableKind: string | null | undefined,
  hasOpenOperationalObject: boolean,
  isReopened: boolean,
): boolean {
  if (durableKind === 'actor') return false
  return hasOpenOperationalObject || isReopened
}

// Statuts « ouverts » par type d'objet métier — cohérents avec getNavigableSubjectsForSite.activeObjects.
export const OPEN_ACTION_STATUS = new Set(['open', 'planned'])
export const OPEN_RESERVE_STATUS = new Set(['open'])
export const OPEN_DEADLINE_STATUS = new Set(['to_plan', 'planned'])
export const OPEN_DECISION_STATUS = new Set(['proposee'])

/** True si l'objet métier (entityType + status) est un objet opérationnel OUVERT. */
export function isOpenOperationalObjectStatus(entityType: string, status: string | null): boolean {
  switch (entityType) {
    case 'site_action': return OPEN_ACTION_STATUS.has(status ?? '')
    case 'site_reserve': return OPEN_RESERVE_STATUS.has(status ?? '')
    case 'site_deadline': return OPEN_DEADLINE_STATUS.has(status ?? '')
    case 'site_decision': return OPEN_DECISION_STATUS.has(status ?? '')
    default: return false
  }
}
