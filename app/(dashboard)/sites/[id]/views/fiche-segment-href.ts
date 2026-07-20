// ── L'ADRESSE DU MAILLON SUIVANT ─────────────────────────────────────────────
// Ce module a d'abord servi de TRADUCTEUR : les read models produisaient des liens
// par paramètres (`/sites/<id>?action=<id>&action_source=decision`) et le panneau
// les réécrivait en segments au moment de les afficher.
//
// La migration des adresses (2026-07-20) a supprimé ce besoin : les read models
// émettent désormais l'adresse canonique. `toSegmentHref` n'avait plus aucune
// source à traduire, il a été retiré — un traducteur sans texte à traduire est une
// dette, pas un filet de sécurité.
//
// Restent les deux règles qui n'ont pas d'équivalent ailleurs.

/** `/sites/<id>/decision/<x>` → `/sites/<id>` : la base, quel que soit le maillon ouvert.
 *  Chaque objet qui reçoit une adresse s'ajoute ici — et nulle part ailleurs. */
function baseChantier(pathname: string): string {
  return pathname.replace(/\/(decision|action|reunion|document|reserve|observation|intervenant)\/[^/]+\/?$/, '')
}

/** Suivre une relation ne change pas le décor : l'onglet, le sous-onglet et les
 *  filtres courants voyagent avec l'adresse de la fiche suivante.
 *
 *  Le pendant côté onglet est `mergeFicheHref` (lib/knowledge/fiche-href.ts), qui
 *  doit FUSIONNER deux querys. Ici, dans un panneau, la cible n'en a pas : il n'y
 *  a rien à fusionner, seulement un contexte à emporter. */
export function garderContexte(href: string | null | undefined, search: string): string | null {
  if (!href) return null
  if (!search || href.includes('?')) return href
  return `${href}?${search}`
}

/** L'adresse de l'ONGLET, sans aucune fiche : c'est « quitter l'espace des fiches ».
 *  Mesuré en production (2026-07-20) : avec une chaîne Décision → Action, fermer par
 *  `history.back()` ne quittait PAS l'espace — il reculait d'un objet, et le panneau
 *  restait ouvert sur la Décision. Les deux intentions sont donc distinctes :
 *    · « revenir d'un objet »  → le Précédent du navigateur (une entrée d'historique) ;
 *    · « quitter l'espace »    → cette adresse-ci, en une seule fois.
 *  D'où la dissociation : le × ne peut pas être un retour d'historique. */
export function quitterEspaceHref(pathname: string, search: string): string {
  const base = baseChantier(pathname)
  return search ? `${base}?${search}` : base
}
