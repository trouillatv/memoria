'use client'

// ── L'ESPACE DES FICHES ET SON HISTORIQUE ────────────────────────────────────
// Invariant d'expérience (ADR) : après une fermeture par ×, une pression immédiate
// sur le Précédent du navigateur NE DOIT PAS rouvrir une fiche.
//
// Le × ne peut donc pas se contenter de `replace` vers l'onglet : les entrées des
// fiches parcourues resteraient dans la pile, et un Précédent y replongerait
// (mesuré en production le 2026-07-20). Il faut CONSOMMER ces entrées.
//
// Combien ? `history.length` ne le dit pas : elle n'aide pas à connaître la
// POSITION, et ne diminue pas quand on revient en arrière. On tient donc notre
// propre pile du parcours réellement effectué dans l'espace.
//
// Elle vit au niveau du module : elle survit aux navigations client (le module
// reste chargé) et repart de zéro au rechargement complet — ce qui est correct,
// puisqu'un rechargement direct n'affiche pas de panneau, donc pas de ×.

let pile: string[] = []

/** À appeler chaque fois qu'une fiche s'affiche, avec le chemin courant. */
export function noterFiche(pathname: string): void {
  const i = pile.lastIndexOf(pathname)
  if (i >= 0) pile.length = i + 1 // on est REVENU sur un maillon déjà visité
  else pile.push(pathname) // on a AVANCÉ d'un maillon
}

/** Le nombre d'entrées d'historique à consommer pour retrouver le contexte. */
export function profondeur(): number {
  return pile.length
}

/** « Terminer le parcours courant » : on quitte l'espace en une fois.
 *  Retourne true si l'historique a suffi ; false s'il faut un repli (navigation
 *  directe vers l'onglet), par exemple quand la pile est vide après un
 *  rechargement. */
export function terminerParcours(): boolean {
  const n = pile.length
  pile = []
  if (n <= 0) return false
  window.history.go(-n)
  return true
}
