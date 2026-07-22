// L'ERREUR QUI REFUSE DE CHOISIR À LA PLACE DE L'HUMAIN.
//
// Fichier volontairement SANS AUCUN IMPORT : `lib/db/users` et
// `lib/auth/memberships` en ont tous deux besoin, et se référencent déjà l'un
// l'autre. La poser ici est ce qui évite le cycle.

/**
 * Levée quand un compte appartient à plusieurs entreprises et que le contexte
 * ne permet pas de dire laquelle utiliser.
 *
 * C'est un SIGNAL, pas une panne : elle désigne exactement les endroits où du
 * code écrit avant le multi-organisations exige une organisation unique. Chaque
 * occurrence est une ligne de la liste de travail de M2/M3.
 *
 * L'alternative — rendre l'organisation « par défaut » — écrirait dans AGP une
 * donnée saisie pour SERVINOR, sans erreur, sans trace, et personne ne s'en
 * apercevrait avant l'audit.
 */
export class OrganisationAmbigueError extends Error {
  readonly organizationIds: string[]
  constructor(organizationIds: string[]) {
    super(
      'Organisation ambiguë : ce compte appartient à plusieurs entreprises. '
      + 'Le contexte ne permet pas de déterminer laquelle utiliser.',
    )
    this.name = 'OrganisationAmbigueError'
    this.organizationIds = organizationIds
  }
}
