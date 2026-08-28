// #232 — GARDE D'INTÉGRITÉ : le nom propre / établissement d'un site ne doit JAMAIS
// devenir une identité canonique ACTEUR.
//
// Défaut prouvé récurrent (audit #232) : l'extraction classe le nom de l'établissement
// (« BELLA NAPOLI ») en proposal_family=company ; le gate de création d'identité
// (extract-historical-pv, orphelins acteurs) crée alors un canonical_subject kind='actor'
// pour le site lui-même — une identité qui n'aurait jamais dû exister.
//
// Ce garde bloque la CRÉATION au gate (barrière d'intégrité), sans toucher l'extracteur.
// CONSERVATEUR PAR CONCEPTION : on ne saute la création que sur une ÉGALITÉ NORMALISÉE
// STRICTE contre un alias fiable du site (jamais un containment, jamais du fuzzy). Un faux
// positif supprimerait une vraie entreprise (interdit) ; un faux négatif laisserait le nom
// d'établissement créé (statu quo inoffensif — #228 l'exclut déjà). On penche vers le faux
// négatif : « Bella Napoli Traiteur » n'est PAS le site et reste créé.

/** Normalisation stricte pour comparaison d'identité : minuscules, sans accents, alphanumérique
 *  uniquement, espaces réduits. Pas de suppression de stopwords (on veut l'égalité du nom ENTIER). */
export function normalizeEstablishmentLabel(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // diacritiques
    .replace(/[^a-z0-9]+/g, ' ')     // tout non alphanumérique → espace
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * `true` si `label` désigne l'établissement/site lui-même — égalité normalisée STRICTE
 * contre l'un des alias fiables du site (`sites.name`, `sites.normalized_name`). Les valeurs
 * trop courtes (< 2 caractères normalisés) ne matchent jamais (sécurité).
 */
export function isSiteEstablishmentLabel(
  label: string | null | undefined,
  siteAliases: ReadonlyArray<string | null | undefined>,
): boolean {
  const n = normalizeEstablishmentLabel(label ?? '')
  if (n.length < 2) return false
  for (const alias of siteAliases) {
    if (!alias) continue
    const na = normalizeEstablishmentLabel(alias)
    if (na.length >= 2 && na === n) return true
  }
  return false
}
