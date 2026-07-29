// Bloc structuré du plan de visite pour le prompt de débrief (Sprint 3B).
// Fonction PURE — pas d'accès serveur, testable sans DB.
//
// Doctrine du bloc injecté :
//   - checked    = contrôlé conforme sur place uniquement
//   - still_open = problème persistant — candidat naturel à un point de vigilance,
//                  jamais une action automatique sauf engagement explicite dans le commentaire
//   - not_applicable = ne pas mentionner comme conforme
//   - pending    = non vérifié — ne jamais conclure sur l'état réel
//   - le commentaire humain prévaut sur toute inférence IA
//   - ne jamais inventer un résultat depuis une photo

import type { WatchlistItemPriority, WatchlistItemState } from '@/types/db'
import { computeWatchlistCoverage } from './watchlist-coverage'

export interface WatchlistDebriefItem {
  label: string
  priority: WatchlistItemPriority
  state: WatchlistItemState
  note: string | null
  evidenceCount: number
}

const PRIORITY_FR: Record<WatchlistItemPriority, string> = {
  critical: 'critique',
  important: 'importante',
  normal: 'normale',
}

const STATE_FR: Record<WatchlistItemState, string> = {
  pending: 'non vérifié',
  checked: 'conforme',
  still_open: 'toujours ouvert',
  not_applicable: 'sans objet',
}

/** Construit le bloc texte injecté dans le prompt de débrief.
 *  Retourne null si la liste est vide — le prompt reste identique à l'existant. */
export function buildWatchlistDebriefBlock(items: WatchlistDebriefItem[]): string | null {
  if (items.length === 0) return null
  const coverage = computeWatchlistCoverage(items)
  const lines: string[] = [
    '=== PLAN DE VISITE — RÉSULTATS DÉCLARÉS PAR L\'UTILISATEUR ===',
    'Ces résultats sont des faits structurés et prioritaires. Ne les réinterprète pas. Ne les réordonne pas.',
    '',
    `Couverture : ${coverage.total - coverage.pending}/${coverage.total} point${coverage.total > 1 ? 's' : ''} traité${coverage.total - coverage.pending > 1 ? 's' : ''}.`,
    '',
  ]
  items.forEach((item, i) => {
    lines.push(`${i + 1}. ${item.label}`)
    lines.push(`   Priorité : ${PRIORITY_FR[item.priority]}`)
    lines.push(`   État : ${STATE_FR[item.state]}`)
    if (item.note) lines.push(`   Commentaire : ${item.note}`)
    if (item.evidenceCount > 0) lines.push(`   Preuves : ${item.evidenceCount}`)
    lines.push('')
  })
  lines.push(
    '--- Invariants de génération ---',
    '- checked = contrôlé conforme sur place uniquement',
    '- still_open = problème ou point restant ouvert ; candidat naturel à un point de vigilance',
    '- not_applicable = ne pas présenter comme conforme',
    '- pending = non vérifié ; ne jamais conclure sur son état réel',
    '- le commentaire humain prévaut sur toute inférence IA',
    "- ne jamais transformer l'absence de commentaire en conformité",
    "- un still_open ne devient une action que si le commentaire contient un engagement explicite",
    "- ne jamais inventer un résultat à partir d'une photo",
  )
  return lines.join('\n')
}
