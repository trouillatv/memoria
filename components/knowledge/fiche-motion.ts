// ── PR2 · TRANSFORMATION DU CONTENU ──────────────────────────────────────────
// La COQUILLE ne bouge jamais (acquis de PR1 : taille, ombre, position, voile,
// scroll du fond strictement conservés). Quand l'objet affiché change, seuls
// TROIS éléments se transforment :
//   · le titre  → crossfade
//   · le chapô  → crossfade
//   · le corps  → crossfade + glissement de quelques pixels
// Le FIL n'est pas animé : c'est le repère (7e règle — les repères priment sur
// les mouvements). Objectif : que l'utilisateur OUBLIE qu'une transition a eu
// lieu ; si l'animation se remarque, elle a échoué.
//
// Un seul endroit pour régler durée / easing / amplitude → c'est ici que PR3
// (polissage perceptif) interviendra, nulle part ailleurs.
// `motion-reduce:animate-none` : aucune animation si l'OS la refuse.

export const FICHE_TITLE_MOTION =
  'animate-in fade-in-0 duration-200 ease-out motion-reduce:animate-none'

export const FICHE_BODY_MOTION =
  'animate-in fade-in-0 slide-in-from-bottom-1 duration-200 ease-out motion-reduce:animate-none'
