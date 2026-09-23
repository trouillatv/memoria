// MÉMOIRE DU VERDICT « NE PLUS SUIVRE » (Plan de visite, Lot B) — fonction PURE.
//
// Un objet source explicitement `dismissed_permanently` ne doit plus JAMAIS
// être reproposé, quel que soit le motif de la visite suivante et quel que
// soit un éventuel changement matériel de la source. C'est la différence avec
// [[filterSettledNotApplicable]] (legacy `not_applicable`) : ici, aucun motif,
// aucune fraîcheur — l'exclusion est définitive dès le verdict rendu.
//
// `not_applicable_visit` (sans objet POUR CETTE visite) n'entre PAS dans ce
// mécanisme : il doit rester reproposable à N+1, donc jamais filtré ici.

import type { WatchlistProposal } from '@/lib/visits/watchlist-proposals'
import { watchlistSourceKey } from '@/lib/visits/watchlist-not-applicable-memory'

/**
 * Retire des propositions automatiques toute source dont la clé
 * (source_kind|source_ref) a déjà reçu un verdict `dismissed_permanently`.
 */
export function filterDismissedPermanently(
  proposals: WatchlistProposal[],
  dismissedKeys: ReadonlySet<string>,
): WatchlistProposal[] {
  if (proposals.length === 0 || dismissedKeys.size === 0) return proposals
  return proposals.filter((p) => {
    if (!p.source_ref) return true // sans identité de source, aucune mémoire possible
    return !dismissedKeys.has(watchlistSourceKey(p.source_kind, p.source_ref))
  })
}
