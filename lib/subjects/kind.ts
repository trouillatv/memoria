/**
 * Primitive partagée pour la classification des canonical_subject par kind.
 *
 * Un sujet est "opérationnel" s'il peut stagger, porter des objets métier
 * et figurer dans les buckets À surveiller / En mouvement / En attente.
 * person, company, knowledge_fact sont des connaissances navigables
 * mais pas des sujets opérationnels par défaut.
 *
 * Utilisé par :
 *  - getNavigableSubjectsForSite() (tri serveur)
 *  - SujetsList.tsx (bucketing client)
 */

const NON_OPERATIONAL_KINDS = new Set(['person', 'company', 'knowledge_fact'])

/**
 * Retourne true si le sujet peut figurer dans les buckets opérationnels
 * (À surveiller, En mouvement, En attente).
 * kind=null est traité comme opérationnel (sujet dont le type n'est pas encore déterminé).
 */
export function isOperationalSubject(kind: string | null | undefined): boolean {
  if (kind == null) return true
  return !NON_OPERATIONAL_KINDS.has(kind)
}

/** Retourne true pour person et company uniquement (acteurs humains/entreprises). */
export function isActorKind(kind: string | null | undefined): boolean {
  return kind === 'person' || kind === 'company'
}
