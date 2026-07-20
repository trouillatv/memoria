// ── PROTOTYPE Lot 3 · garder la chaîne DANS le nouveau modèle d'adresses ─────
// Les read models produisent encore des liens par paramètres
// (`/sites/<id>?action=<id>&action_source=decision`). Tant que la migration n'est
// pas décidée, on ne les touche pas : le panneau réécrit le lien au moment de
// l'afficher, vers `/sites/<id>/action/<id>?<query courante>`.
//
// Sans cette réécriture, suivre une relation depuis un panneau retomberait sur
// l'ancien chemin — et la chaîne à deux objets, celle qui doit trancher la règle
// « fermer = retour navigateur », n'existerait jamais.

/** `/sites/<id>/decision/<x>` → `/sites/<id>` : la base, quel que soit le maillon ouvert.
 *  Chaque objet qui reçoit une adresse au Lot 4 s'ajoute ici — et nulle part ailleurs. */
function baseChantier(pathname: string): string {
  return pathname.replace(/\/(decision|action|reunion|document)\/[^/]+\/?$/, '')
}

/** Suivre une relation ne change pas le décor : l'onglet, le sous-onglet et les
 *  filtres courants voyagent avec l'adresse de la fiche suivante.
 *  `toSegmentHref` le fait déjà pour les liens hérités (par paramètres) ; les read
 *  models du Lot 4 produisent directement des adresses de segment, qui ont le même
 *  besoin — sans quoi fermer la fiche retomberait sur l'onglet par défaut. */
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

export function toSegmentHref(
  hrefLegacy: string | null | undefined,
  type: 'action' | 'decision',
  pathname: string,
  search: string,
): string | null {
  if (!hrefLegacy) return null
  const id = new RegExp(`[?&]${type}=([^&]+)`).exec(hrefLegacy)?.[1]
  if (!id) return null
  return `${baseChantier(pathname)}/${type}/${id}${search ? `?${search}` : ''}`
}
