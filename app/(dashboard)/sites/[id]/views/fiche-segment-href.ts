// ── PROTOTYPE Lot 3 · garder la chaîne DANS le nouveau modèle d'adresses ─────
// Les read models produisent encore des liens par paramètres
// (`/sites/<id>?action=<id>&action_source=decision`). Tant que la migration n'est
// pas décidée, on ne les touche pas : le panneau réécrit le lien au moment de
// l'afficher, vers `/sites/<id>/action/<id>?<query courante>`.
//
// Sans cette réécriture, suivre une relation depuis un panneau retomberait sur
// l'ancien chemin — et la chaîne à deux objets, celle qui doit trancher la règle
// « fermer = retour navigateur », n'existerait jamais.

/** `/sites/<id>/decision/<x>` → `/sites/<id>` : la base, quel que soit le maillon ouvert. */
function baseChantier(pathname: string): string {
  return pathname.replace(/\/(decision|action)\/[^/]+\/?$/, '')
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
