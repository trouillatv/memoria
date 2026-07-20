// ── OUVRIR UNE FICHE SANS CHANGER LE DÉCOR (logique PURE, testable) ──────────
// « Un clic = une continuité » : ouvrir une fiche ne doit jamais modifier le
// contexte derrière elle. Les liens de fiche sont construits côté serveur en
// ABSOLU et écrasent la query courante — l'onglet actif (`tab=`, `memtab=`)
// disparaissait, la page retombait sur l'Aperçu.
//
// Ici on FUSIONNE. Deux formes d'adresse coexistent, et la règle est la même :
//   · MÊME page (`/sites/<id>?action=…`) — l'ancien modèle, par paramètres ;
//   · SEGMENT du même chantier (`/sites/<id>/action/<id>`) — le modèle canonique
//     issu de l'ADR de navigation.
// Dans les deux cas on conserve l'onglet, le sous-onglet et les filtres. Une
// cible hors du chantier courant reste inchangée : on ne lui impose pas un décor
// qui n'est pas le sien.

/** Les paramètres qui désignaient la fiche ouverte, dans l'ancien modèle. */
export const FICHE_PARAMS = [
  'action', 'action_source', 'action_site',
  'decision', 'decision_source',
  'person', 'person_source',
] as const

/** Les objets qui ont une adresse canonique. Un segment de plus s'ajoute ici. */
const SEGMENTS = ['action', 'decision', 'reunion', 'document', 'reserve', 'observation'] as const
const SEGMENT_RE = new RegExp(`^(/sites/[^/]+)/(?:${SEGMENTS.join('|')})/[^/]+/?$`)

/** `/sites/<id>/action/<x>` → `/sites/<id>` ; `/sites/<id>` → lui-même. */
function baseChantier(path: string): string {
  return SEGMENT_RE.exec(path)?.[1] ?? path
}

export function mergeFicheHref(
  pathname: string,
  currentQuery: string,
  href: string | null | undefined,
): string | null {
  if (!href) return null
  const [path, query = ''] = href.split('?')

  // Même chantier ? On compare les BASES : le décor appartient au chantier, pas
  // au maillon ouvert. Sans cela, suivre une relation depuis une fiche déjà
  // ouverte perdrait l'onglet — le pathname courant contient alors un segment.
  if (baseChantier(path) !== baseChantier(pathname)) return href

  const next = new URLSearchParams(currentQuery)
  for (const key of FICHE_PARAMS) next.delete(key)
  for (const [key, value] of new URLSearchParams(query)) next.set(key, value)
  const qs = next.toString()
  return qs ? `${path}?${qs}` : path
}
