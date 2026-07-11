// Propositions PURES de la liste « À vérifier » d'une visite (mig 196).
// Déterministe, zéro IA : on projette les signaux mémoire du chantier (réserves
// ouvertes, actions en retard, fenêtres de preuve…) en 1 à 7 questions de
// contrôle, SPÉCIALISÉES par le motif de la visite. Aucune invention : chaque
// point vient d'un objet réel (source_kind + source_ref = explicabilité).
// Aucune dépendance serveur : testable en CI (projet unit).

import type { MemorySignal, SignalKind } from '@/lib/db/site-memory-signals'
import type { VisitMotive } from '@/types/db'

export interface WatchlistProposal {
  label: string
  source_kind: string
  source_ref: string | null
}

export const WATCHLIST_MAX = 7

/** Formulation « question de contrôle » par type de signal — le point se LIT
 *  comme un geste à faire sur place, pas comme une ligne de base de données. */
const LABELS: Partial<Record<SignalKind, (label: string) => string>> = {
  proof_window_closing: (l) => `Photographier avant : ${l}`,
  reserve_open: (l) => `Constater sur place : ${l}`,
  action_overdue: (l) => `Où en est : ${l} ?`,
  decision_unapplied: (l) => `Appliquée ? ${l}`,
  obligation_neglected: (l) => `Ne pas oublier : ${l}`,
}

/** Signaux retenus + leur ordre, PAR MOTIF. Le motif choisit pour l'utilisateur
 *  ([[doctrine-contexte-adaptatif]]) : une levée de réserves ne parle QUE de
 *  réserves ; une réception élargit aux preuves et décisions. */
function kindsForMotive(motive: VisitMotive | null): SignalKind[] {
  switch (motive) {
    case 'levee_reserves':
      return ['reserve_open']
    case 'reception':
    case 'prereception':
      return ['reserve_open', 'proof_window_closing', 'decision_unapplied', 'obligation_neglected']
    // Première visite / prévisite AO : pas encore de mémoire — aucun faux point.
    case 'premiere':
    case 'previsite_ao':
      return []
    default:
      // Suivi classique : l'irréversible d'abord, puis ce qui traîne.
      return ['proof_window_closing', 'reserve_open', 'action_overdue', 'decision_unapplied', 'obligation_neglected']
  }
}

export function buildWatchlistProposals(
  signals: MemorySignal[],
  motive: VisitMotive | null,
  max = WATCHLIST_MAX,
): WatchlistProposal[] {
  const kinds = kindsForMotive(motive)
  if (kinds.length === 0) return []
  const byKind = new Map(signals.map((s) => [s.kind, s]))
  const out: WatchlistProposal[] = []
  for (const kind of kinds) {
    const signal = byKind.get(kind)
    if (!signal) continue
    const toLabel = LABELS[kind]
    if (!toLabel) continue
    for (const item of signal.items) {
      if (!item.label?.trim()) continue
      out.push({ label: toLabel(item.label.trim()), source_kind: kind, source_ref: item.id || null })
      if (out.length >= max) return out
    }
  }
  return out
}
