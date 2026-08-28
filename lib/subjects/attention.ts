/**
 * Signaux d'attention déterministes pour un sujet canonique.
 *
 * Dérivé uniquement de NavigableSubjectSummary (données déjà disponibles côté client).
 * Aucun LLM, aucune heuristique fragile.
 *
 * Hiérarchie :
 *   VETO    → isClosed, !isOperational (court-circuite tout signal)
 *   CONSÉQUENCE → open_objects, non_conformity, reservation
 *   ÉTAT    → awaiting, overdue (à venir)
 *   TEMPS   → stagnant
 *
 * Le bucket "À surveiller" sélectionne tout sujet opérationnel non clôturé
 * possédant au moins un signal. La stagnation n'est qu'un signal parmi d'autres.
 */

import type { NavigableSubjectSummary } from '@/lib/db/canonical-subject-life'
import { isOperationalSubject } from '@/lib/subjects/kind'

// Doit rester cohérent avec CLOSED_STATUSES dans SujetsList et CLOSED_NAV_STATUSES dans canonical-subject-life.
const CLOSED_STATUSES = new Set(['done', 'cancelled', 'not_applicable'])

export type AttentionReason =
  | 'open_objects'   // activeObjects.total > 0 — conséquence métier directe
  | 'non_conformity' // currentStatus === 'non_compliant'
  | 'reservation'    // kind === 'reservation' (réserve ouverte)
  | 'awaiting'       // currentStatus === 'awaiting_validation'
  | 'stagnant'       // isStagnant (calculé côté serveur : ≥30 j + ≥2 mentions)

export interface SubjectAttentionSignals {
  isClosed: boolean
  isOperational: boolean
  /** Raisons ordonnées par priorité décroissante. Vide si aucun signal. */
  attentionReasons: AttentionReason[]
}

/**
 * Calcule les signaux d'attention à partir d'un NavigableSubjectSummary.
 * Pure function, aucun effet de bord.
 */
export function computeAttentionSignals(s: NavigableSubjectSummary): SubjectAttentionSignals {
  const isClosed = CLOSED_STATUSES.has(s.currentStatus ?? '')
  // #228 : gate opérationnel sur la nature durable (actor exclu), pas sur la famille d'occurrence.
  const isOperational = isOperationalSubject(s.durableKind)

  if (isClosed || !isOperational) {
    return { isClosed, isOperational, attentionReasons: [] }
  }

  const reasons: AttentionReason[] = []

  // Conséquence métier — signal le plus fort
  if (s.activeObjects.total > 0)               reasons.push('open_objects')
  if (s.currentStatus === 'non_compliant')      reasons.push('non_conformity')
  // #228 : le signal `reservation` dépend de la FAMILLE (dominantFamily), pas de la nature durable.
  if (s.dominantFamily === 'reservation')       reasons.push('reservation')

  // État
  if (s.currentStatus === 'awaiting_validation') reasons.push('awaiting')

  // Temps
  if (s.isStagnant)                             reasons.push('stagnant')

  return { isClosed, isOperational, attentionReasons: reasons }
}

/**
 * Construit les fragments textuels décrivant les raisons d'attention.
 * Utilisé par SubjectCard pour afficher "pourquoi ce sujet est à surveiller".
 */
export function formatAttentionFragments(s: NavigableSubjectSummary, reasons: AttentionReason[]): string[] {
  if (reasons.length === 0) return []
  const parts: string[] = []

  if (reasons.includes('open_objects')) {
    const n = s.activeObjects.total
    const objs = `${n} objet${n > 1 ? 's' : ''} actif${n > 1 ? 's' : ''}`
    const actions = s.activeObjects.actionsOpen > 0 && s.activeObjects.actionsOpen < n
      ? ` (${s.activeObjects.actionsOpen} action${s.activeObjects.actionsOpen > 1 ? 's' : ''})`
      : ''
    parts.push(objs + actions)
  }
  if (reasons.includes('non_conformity'))           parts.push('non conforme')
  else if (reasons.includes('reservation'))         parts.push('réserve ouverte')
  if (reasons.includes('awaiting'))                 parts.push('en attente de validation')
  if (reasons.includes('stagnant') && s.stagnationDays > 0) {
    parts.push(`sans évolution depuis ${s.stagnationDays} j`)
  }

  return parts
}
