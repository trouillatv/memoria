// Couverture du plan de visite — fonction PURE, sans accès serveur.
// Alimente la barre de progression (Sprint 2), le dialogue de clôture (Sprint 3A),
// le débrief IA (Sprint 3B) et le futur reporting d'usage.
//
// Invariants clés :
//   - still_open  = traité (l'utilisateur a statué), mais non résolu
//   - not_applicable = traité (ne s'applique pas à cette visite)
//   - pending    = non vérifié — l'absence de traitement est une information métier,
//                 jamais transformée automatiquement en un autre état
//   - completionRate = 1 si liste vide (pas de division par zéro)

import type { WatchlistItemPriority, WatchlistItemState } from '@/types/db'

export interface WatchlistCoverage {
  total: number
  checked: number
  stillOpen: number
  notApplicable: number
  pending: number
  criticalPending: number
  importantPending: number
  /** Taux de traitement (0–1). Vaut 1 si total === 0. */
  completionRate: number
  /** true si aucun point n'est en attente (pending === 0). */
  isComplete: boolean
}

type CoverageItem = {
  state: WatchlistItemState
  priority: WatchlistItemPriority
}

export function computeWatchlistCoverage(items: CoverageItem[]): WatchlistCoverage {
  const total = items.length
  if (total === 0) {
    return {
      total: 0, checked: 0, stillOpen: 0, notApplicable: 0,
      pending: 0, criticalPending: 0, importantPending: 0,
      completionRate: 1, isComplete: true,
    }
  }
  const checked = items.filter((i) => i.state === 'checked').length
  const stillOpen = items.filter((i) => i.state === 'still_open').length
  const notApplicable = items.filter((i) => i.state === 'not_applicable').length
  const pending = items.filter((i) => i.state === 'pending').length
  const pendingItems = items.filter((i) => i.state === 'pending')
  const criticalPending = pendingItems.filter((i) => i.priority === 'critical').length
  const importantPending = pendingItems.filter((i) => i.priority === 'important').length
  const completionRate = (total - pending) / total
  return {
    total, checked, stillOpen, notApplicable, pending,
    criticalPending, importantPending,
    completionRate, isComplete: pending === 0,
  }
}
