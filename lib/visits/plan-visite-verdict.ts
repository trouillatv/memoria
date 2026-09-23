// PLAN DE VISITE — routage métier PUR (Lot B).
//
// Un verdict humain rendu sur un point du Plan de visite ne mute JAMAIS la
// source par texte ou par IA : il est routé exclusivement par `source_kind`,
// vers exactement UNE primitive métier déjà existante (ou aucune, pour un
// constat). Ce module ne fait aucune I/O — il décrit la règle, l'orchestrateur
// (lib/visits/plan-visite-orchestrator.ts) l'exécute.
//
// Vocabulaire figé par source_kind (Vincent, Lot B) — jamais le triplet
// générique Conforme/Toujours ouvert/Sans objet :
//   reserve_open          : Levée / Toujours ouverte / Sans objet pour cette visite
//                            (aucun Ne plus suivre : une réserve ouverte reste un fait tant
//                            qu'elle n'est pas levée).
//   action_overdue        : Fait / Toujours à faire / Sans objet pour cette visite / Ne plus suivre
//   decision_unapplied    : Appliquée / Pas encore appliquée / Sans objet pour cette visite / Ne plus suivre
//   obligation_neglected  : Satisfaite / Toujours à traiter / Sans objet pour cette visite / Ne plus suivre
//   proof_window_closing  : Photographié / Pas encore
//                            (ni Sans objet ni Ne plus suivre : une fenêtre de preuve
//                            manquée est un fait qui ne s'annule jamais, cf.
//                            NEVER_SUPPRESSED dans watchlist-not-applicable-memory.ts).

import type { WatchlistItemState } from '@/types/db'
import type { DiscardMotif } from '@/lib/db/site-actions'

export type PlanVisiteVerdict = 'positif' | 'negatif' | 'sans_objet_visite' | 'ne_plus_suivre'

export interface PlanVisiteVerdictOption {
  verdict: PlanVisiteVerdict
  label: string
}

const RESERVE_OPTIONS: readonly PlanVisiteVerdictOption[] = [
  { verdict: 'positif', label: 'Levée' },
  { verdict: 'negatif', label: 'Toujours ouverte' },
  { verdict: 'sans_objet_visite', label: 'Sans objet pour cette visite' },
]

const ACTION_OPTIONS: readonly PlanVisiteVerdictOption[] = [
  { verdict: 'positif', label: 'Fait' },
  { verdict: 'negatif', label: 'Toujours à faire' },
  { verdict: 'sans_objet_visite', label: 'Sans objet pour cette visite' },
  { verdict: 'ne_plus_suivre', label: 'Ne plus suivre' },
]

const DECISION_OPTIONS: readonly PlanVisiteVerdictOption[] = [
  { verdict: 'positif', label: 'Appliquée' },
  { verdict: 'negatif', label: 'Pas encore appliquée' },
  { verdict: 'sans_objet_visite', label: 'Sans objet pour cette visite' },
  { verdict: 'ne_plus_suivre', label: 'Ne plus suivre' },
]

const OBLIGATION_OPTIONS: readonly PlanVisiteVerdictOption[] = [
  { verdict: 'positif', label: 'Satisfaite' },
  { verdict: 'negatif', label: 'Toujours à traiter' },
  { verdict: 'sans_objet_visite', label: 'Sans objet pour cette visite' },
  { verdict: 'ne_plus_suivre', label: 'Ne plus suivre' },
]

const PROOF_OPTIONS: readonly PlanVisiteVerdictOption[] = [
  { verdict: 'positif', label: 'Photographié' },
  { verdict: 'negatif', label: 'Pas encore' },
]

const OPTIONS_BY_KIND: Readonly<Record<string, readonly PlanVisiteVerdictOption[]>> = {
  reserve_open: RESERVE_OPTIONS,
  action_overdue: ACTION_OPTIONS,
  decision_unapplied: DECISION_OPTIONS,
  obligation_neglected: OBLIGATION_OPTIONS,
  proof_window_closing: PROOF_OPTIONS,
}

/** Options de verdict offertes pour ce source_kind. Vide (ex. `manual`) = pas de
 *  Plan de visite structuré pour ce point — reste sur les états legacy. */
export function planVisiteVerdictOptions(sourceKind: string | null): readonly PlanVisiteVerdictOption[] {
  if (!sourceKind) return []
  return OPTIONS_BY_KIND[sourceKind] ?? []
}

export function isValidPlanVisiteVerdict(sourceKind: string | null, verdict: PlanVisiteVerdict): boolean {
  return planVisiteVerdictOptions(sourceKind).some((o) => o.verdict === verdict)
}

/** État watchlist à persister — UNIFORME quel que soit le source_kind. Le
 *  vocabulaire métier (labels ci-dessus) reste distinct de ce mécanisme interne. */
export function watchlistStateForVerdict(verdict: PlanVisiteVerdict): WatchlistItemState {
  switch (verdict) {
    case 'positif': return 'checked'
    case 'negatif': return 'still_open'
    case 'sans_objet_visite': return 'not_applicable_visit'
    case 'ne_plus_suivre': return 'dismissed_permanently'
  }
}

/** Seuls Fait et Ne plus suivre sur une action exigent un commentaire réel
 *  (mini-flow, jamais généré) — les autres verdicts n'écrivent qu'un constat. */
export function planVisiteVerdictRequiresComment(sourceKind: string | null, verdict: PlanVisiteVerdict): boolean {
  return sourceKind === 'action_overdue' && (verdict === 'positif' || verdict === 'ne_plus_suivre')
}

const STATE_TO_VERDICT: Partial<Record<WatchlistItemState, PlanVisiteVerdict>> = {
  checked: 'positif',
  still_open: 'negatif',
  not_applicable_visit: 'sans_objet_visite',
  dismissed_permanently: 'ne_plus_suivre',
}

/** Verdict correspondant à un état watchlist déjà persisté — pour surligner le
 *  bouton déjà choisi. `null` si l'item n'a pas encore reçu de verdict structuré
 *  (pending, ou not_applicable legacy hors périmètre Plan de visite). */
export function verdictForWatchlistState(state: WatchlistItemState): PlanVisiteVerdict | null {
  return STATE_TO_VERDICT[state] ?? null
}

export type PlanVisiteMutation =
  | { kind: 'lift_reserve' }
  | { kind: 'complete_action' }
  | { kind: 'confirm_action_open' }
  | { kind: 'discard_action'; motif: DiscardMotif }
  | { kind: 'set_decision_statut'; statut: 'appliquee' | 'caduque' }
  | { kind: 'set_obligation_status'; status: 'satisfaite' | 'non_applicable' }
  | { kind: 'constat' }

/**
 * Résout la mutation métier à exécuter pour ce couple (source_kind, verdict).
 * `null` = combinaison invalide (jamais offerte par `planVisiteVerdictOptions`) —
 * l'orchestrateur doit refuser avant toute écriture.
 */
export function resolvePlanVisiteMutation(
  sourceKind: string | null,
  verdict: PlanVisiteVerdict,
): PlanVisiteMutation | null {
  if (!isValidPlanVisiteVerdict(sourceKind, verdict)) return null
  switch (sourceKind) {
    case 'reserve_open':
      return verdict === 'positif' ? { kind: 'lift_reserve' } : { kind: 'constat' }
    case 'action_overdue':
      if (verdict === 'positif') return { kind: 'complete_action' }
      if (verdict === 'negatif') return { kind: 'confirm_action_open' }
      if (verdict === 'ne_plus_suivre') return { kind: 'discard_action', motif: 'non_applicable' }
      return { kind: 'constat' } // sans_objet_visite
    case 'decision_unapplied':
      if (verdict === 'positif') return { kind: 'set_decision_statut', statut: 'appliquee' }
      if (verdict === 'ne_plus_suivre') return { kind: 'set_decision_statut', statut: 'caduque' }
      return { kind: 'constat' } // negatif, sans_objet_visite
    case 'obligation_neglected':
      if (verdict === 'positif') return { kind: 'set_obligation_status', status: 'satisfaite' }
      if (verdict === 'ne_plus_suivre') return { kind: 'set_obligation_status', status: 'non_applicable' }
      return { kind: 'constat' } // negatif, sans_objet_visite
    case 'proof_window_closing':
      return { kind: 'constat' } // positif et negatif : aucune mutation métier, jamais
    default:
      return null
  }
}
