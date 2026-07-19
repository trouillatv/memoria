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
// DEUX ÉVÉNEMENTS DISTINCTS, DEUX GESTES DISTINCTS (Vincent, 2026-07-20) :
//   1. « la fiche APPARAÎT » → le changement est DÉJÀ expliqué par le panneau qui
//      arrive (voile + panneau + prise de contexte). Un mouvement interne
//      n'apporte aucune information et entre en concurrence → AUCUNE animation.
//   2. « la fiche CHANGE D'OBJET » → le panneau ne bouge plus, l'œil est sur le
//      contenu. Le mouvement dit alors quelque chose : « tu es toujours ici, mais
//      ce que tu regardes a changé » → là, il a un sens.
// D'où la règle : UN MOUVEMENT QUI N'EXPLIQUE AUCUN CHANGEMENT SUPPLÉMENTAIRE EST
// INUTILE ET DOIT ÊTRE SUPPRIMÉ. C'est le SENS qui décide, pas l'esthétique.
// → ces classes ne sont appliquées que sur un changement d'objet (`animateContent`).
//
// Un seul endroit pour régler durée / easing / amplitude → c'est ici que PR3
// (polissage perceptif) interviendra, nulle part ailleurs.
// `motion-reduce:animate-none` : aucune animation si l'OS la refuse.

export const FICHE_TITLE_MOTION =
  'animate-in fade-in-0 duration-200 ease-out motion-reduce:animate-none'

export const FICHE_BODY_MOTION =
  'animate-in fade-in-0 slide-in-from-bottom-1 duration-200 ease-out motion-reduce:animate-none'
