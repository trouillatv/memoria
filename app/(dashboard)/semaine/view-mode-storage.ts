// Phase 9 — Vue Semaine & Équipes (Slice 9.5)
//
// Helpers purs de parse/format pour le mode de vue de la grille semaine.
//
// Doctrine V2 :
//   - Vue Site × Jour = PRIMAIRE (default).
//   - Vue Équipe × Jour = secondaire, accessible via toggle.
//   - URL `?view=team` active la vue secondaire. L'absence de paramètre
//     (ou n'importe quelle autre valeur) retombe sur la vue primaire.
//
// Aucune persistance localStorage côté client : l'URL est la source de vérité
// (partage facile, pas de "drift" entre onglets, pas de SSR mismatch).

export type WeekViewMode = 'site' | 'team'

export const DEFAULT_VIEW_MODE: WeekViewMode = 'site'

/**
 * Parse le paramètre `?view=...` en mode de vue.
 *
 * - `'team'` → mode équipe
 * - tout autre valeur (y compris `undefined`, vide, `'site'`, etc.) → mode site
 *
 * Le mode site est volontairement le default absolu : doctrine V2 impose
 * la vue Site × Jour comme primaire.
 */
export function parseViewMode(raw: string | undefined | null): WeekViewMode {
  if (raw === 'team') return 'team'
  return 'site'
}

/**
 * Inverse de `parseViewMode` : produit la valeur canonique à mettre dans
 * l'URL, OU `null` si on est sur le mode default (URL canonique sans param).
 *
 * Convention : on n'écrit JAMAIS `?view=site` dans l'URL — c'est le default,
 * on l'omet pour garder une URL propre.
 */
export function formatViewMode(mode: WeekViewMode): string | null {
  if (mode === 'team') return 'team'
  return null
}
