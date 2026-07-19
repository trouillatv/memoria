// ── OUVRIR UNE FICHE SANS CHANGER LE DÉCOR (logique PURE, testable) ──────────
// « Un clic = une continuité » : ouvrir une fiche ne doit jamais modifier le
// contexte derrière elle. Les liens de fiche sont construits côté serveur en
// ABSOLU (`/sites/<id>?action=<id>`) et écrasent la query courante — l'onglet
// actif (`tab=`, `memtab=`) disparaissait, la page retombait sur l'Aperçu.
//
// Ici on FUSIONNE : même page → on conserve l'onglet, le sous-onglet, les
// filtres ; autre page → href inchangé (réunion, autre chantier), c'est la
// limite assumée du Lot 3 « Navigation contextuelle entre objets ».

/** Les paramètres qui désignent la fiche ouverte. Un seul maillon actif à la fois. */
export const FICHE_PARAMS = [
  'action', 'action_source', 'action_site',
  'decision', 'decision_source',
  'person', 'person_source',
] as const

export function mergeFicheHref(
  pathname: string,
  currentQuery: string,
  href: string | null | undefined,
): string | null {
  if (!href) return null
  const [path, query = ''] = href.split('?')
  // Cible sur une AUTRE page : on n'y touche pas.
  if (path !== pathname) return href

  const next = new URLSearchParams(currentQuery)
  for (const key of FICHE_PARAMS) next.delete(key)
  for (const [key, value] of new URLSearchParams(query)) next.set(key, value)
  const qs = next.toString()
  return qs ? `${path}?${qs}` : path
}
