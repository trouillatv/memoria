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

/**
 * #228 — L'éligibilité opérationnelle se décide sur la NATURE DURABLE du sujet
 * (canonical_subject.kind = actor | business_subject, mig 355), JAMAIS sur la
 * famille de ses occurrences. Un business_subject reste opérationnel même si sa
 * 1re occurrence est un knowledge_fact ; seul un `actor` est non opérationnel.
 *
 * durableKind=null (legacy sans nature explicite) → opérationnel (business-like).
 *
 * Utilisé par :
 *  - getNavigableSubjectsForSite() (tri serveur, via navSortPriority)
 *  - computeAttentionSignals() (gate opérationnel)
 *  - SujetsList.tsx (bucketing client)
 */
export function isOperationalSubject(durableKind: string | null | undefined): boolean {
  return durableKind !== 'actor'
}

/** Retourne true pour la nature durable acteur (canonical_subject.kind='actor', mig 355). */
export function isActorKind(durableKind: string | null | undefined): boolean {
  return durableKind === 'actor'
}
