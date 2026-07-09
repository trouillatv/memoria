// MISE EN SCÈNE — couche PURE (imports type-only, testable en CI).
//
// Doctrine (Vincent 2026-07-10) : deux responsabilités distinctes —
//   le moteur MÉTIER (détecteurs) répond « que se passe-t-il ? » ;
//   la mise en scène répond « dans quel ordre le raconter ? ».
// L'ordre du récit dépend de la COUTURE, pas du signal. Avant ce module, cet
// ordre était écrit à la main dans trois surfaces (Matin, réunion, Journal) —
// constat de duplication, d'où l'abstraction (jamais l'inverse).
//
// RÈGLE ANTI-GOD-FILE (Vincent, dès la naissance du module) : UNE COUTURE = UN
// FICHIER (scene/matin.ts, scene/reunion.ts, demain scene/preparation.ts…).
// Cet index ne fait que DÉLÉGUER — si une logique métier ou un ordre inline
// apparaît ici, c'est une régression.
//
// GELÉ (même session) : le moteur de gestes (nextGesture/workflow générique).
// Un seul cycle de vie existe dans le produit (ctaLabel du Journal) — le jour
// où un deuxième apparaît (réception, audit…), l'abstraction aura son constat.
import type { MemorySignal, SignalKind } from '@/lib/db/site-memory-signals'
import { MATIN } from './matin'
import { REUNION } from './reunion'

/** Les coutures qui racontent des signaux — chacune a son ordre éditorial,
 *  dans SON fichier. */
export type SceneMoment = 'matin' | 'reunion'

export const SCENE_ORDER: Record<SceneMoment, SignalKind[]> = {
  matin: MATIN,
  reunion: REUNION,
}

/** Ordonne des signaux pour une couture donnée. Kind inconnu → en fin de récit
 *  (jamais d'exception : un nouveau détecteur apparaît, il se raconte en dernier
 *  tant qu'on ne lui a pas donné sa place dans chaque scène). */
export function orderSignals(signals: MemorySignal[], moment: SceneMoment): MemorySignal[] {
  const rank = new Map(SCENE_ORDER[moment].map((k, i) => [k, i]))
  return [...signals].sort((a, b) => (rank.get(a.kind) ?? 99) - (rank.get(b.kind) ?? 99))
}
