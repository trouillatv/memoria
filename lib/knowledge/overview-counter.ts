// #231 Aperçu Lot C — invariant des compteurs de l'Aperçu.
//
// RÈGLE FIGÉE (Vincent) : population source unique → compteur exhaustif → aperçu
// éventuellement capé → « +N » exact → destination sur CETTE MÊME population.
// Jamais : « compteur A → slice B → lien vers population C » (la cause des deux
// défauts #231). Ces fonctions sont PURES et testables : elles garantissent que
// le nombre affiché, le « +N autres » et le total dérivent d'un seul comptage.

export interface OverviewSlice<T> {
  /** Taille de la population COMPLÈTE (le nombre annoncé dans le titre). */
  total: number
  /** Éléments réellement affichés (bornés par le cap). */
  shown: T[]
  /** total − shown.length. Arithmétiquement exact, jamais négatif. */
  hiddenCount: number
}

/** Cape une population dont on possède la liste COMPLÈTE. `total` = liste entière. */
export function sliceOverview<T>(all: readonly T[], cap: number): OverviewSlice<T> {
  const total = all.length
  const shown = all.slice(0, Math.max(0, cap))
  return { total, shown, hiddenCount: total - shown.length }
}

/**
 * Reste exact quand on ne possède qu'un COMPTE de population + un échantillon déjà
 * tronqué (cas « proposées » : le compteur vient de la projection, l'échantillon
 * est `proposedTop`). `total` et `shownLength` DOIVENT provenir de la même population.
 */
export function exactRemainder(total: number, shownLength: number): number {
  return Math.max(0, total - shownLength)
}
