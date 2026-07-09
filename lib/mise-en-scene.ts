// MISE EN SCÈNE — couche PURE (imports type-only, testable en CI).
//
// Doctrine (Vincent 2026-07-10) : deux responsabilités distinctes —
//   le moteur MÉTIER (détecteurs) répond « que se passe-t-il ? » ;
//   la mise en scène répond « dans quel ordre le raconter ? ».
// L'ordre du récit dépend de la COUTURE, pas du signal : le MATIN on agit
// (l'irréversible et le daté d'abord) ; en RÉUNION on anime une discussion
// (la concentration des sujets d'abord). Avant ce module, cet ordre était
// écrit à la main dans trois surfaces (Matin, réunion, Journal) — constat
// de duplication, d'où l'abstraction (jamais l'inverse).
//
// GELÉ (même session) : le moteur de gestes (nextGesture/workflow générique).
// Un seul cycle de vie existe dans le produit (ctaLabel du Journal) — le jour
// où un deuxième apparaît (réception, audit…), l'abstraction aura son constat.
import type { MemorySignal, SignalKind } from '@/lib/db/site-memory-signals'

/** Les coutures qui racontent des signaux — chacune a son ordre éditorial. */
export type SceneMoment = 'matin' | 'reunion'

export const SCENE_ORDER: Record<SceneMoment, SignalKind[]> = {
  /** Le MATIN on agit : l'irréversible avant tout (le retard se rattrape, la
   *  preuve recouverte jamais), puis l'actionnable daté, puis le structurel. */
  matin: [
    'proof_window_closing',
    'action_overdue',
    'obligation_neglected',
    'decision_unapplied',
    'reserve_open',
    'actor_absent',
    'action_recurring',
    'actor_congestion',
    'recurring_topic',
  ],
  /** En RÉUNION on anime : l'irréversible d'abord quand même, puis « de quoi
   *  cette réunion va parler » (concentration), puis ce qui traîne. */
  reunion: [
    'proof_window_closing',
    'actor_congestion',
    'obligation_neglected',
    'action_overdue',
    'action_recurring',
    'decision_unapplied',
    'actor_absent',
    'reserve_open',
    'recurring_topic',
  ],
}

/** Ordonne des signaux pour une couture donnée. Kind inconnu → en fin de récit
 *  (jamais d'exception : un nouveau détecteur apparaît, il se raconte en dernier
 *  tant qu'on ne lui a pas donné sa place dans chaque scène). */
export function orderSignals(signals: MemorySignal[], moment: SceneMoment): MemorySignal[] {
  const rank = new Map(SCENE_ORDER[moment].map((k, i) => [k, i]))
  return [...signals].sort((a, b) => (rank.get(a.kind) ?? 99) - (rank.get(b.kind) ?? 99))
}
