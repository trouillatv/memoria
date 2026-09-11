// ── FILTRAGE PUR DE LA LISTE DES POINTS (Lot 1, mandat Vincent) ──
//
// Séparé de `tracked-point-list.ts` car ce dernier est server-only (accès DB) et ce module
// doit rester importable depuis un composant client (`PointsListView`) pour le filtrage en
// mémoire. Aucun accès réseau ici, jamais de recalcul d'état — uniquement du tri/filtrage pur
// sur les entrées déjà chargées côté serveur.

import type { PointListEntry } from '@/lib/knowledge/tracked-point-list'
import type { PointComputedCurrentState } from '@/lib/knowledge/tracked-point-lifecycle-reducer'

export interface PointListFilters {
  query: string
  state: PointComputedCurrentState | 'all'
  subjectId: string | 'all'
  actor: string | 'all'
  // Filtre « Besoin de moi » (mandat Vincent, lot UX Cockpit+Points) : ne garde que les
  // Points référencés structurellement par NeedsYou (needsYouCount > 0).
  needsYouOnly: boolean
}

export const DEFAULT_POINT_LIST_FILTERS: PointListFilters = {
  query: '',
  state: 'all',
  subjectId: 'all',
  actor: 'all',
  needsYouOnly: false,
}

export function filterPointList(points: PointListEntry[], filters: PointListFilters): PointListEntry[] {
  const query = filters.query.trim().toLowerCase()
  return points.filter((p) => {
    if (filters.state !== 'all' && p.derivedState !== filters.state) return false
    if (filters.subjectId !== 'all' && p.ownerCanonicalSubjectId !== filters.subjectId) return false
    if (filters.actor !== 'all' && !p.actorNames.includes(filters.actor)) return false
    if (filters.needsYouOnly && p.needsYouCount === 0) return false
    if (query && !p.label.toLowerCase().includes(query)) return false
    return true
  })
}
