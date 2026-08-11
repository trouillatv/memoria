import type { DbKnowledgeProposal } from '@/lib/db/knowledge-proposals'

/**
 * Résultat de la résolution d'une proposition superseded.
 *
 * Trois niveaux, par ordre de fiabilité :
 *   replaced_by       — superseded_by FK renseigné (preuve structurelle directe)
 *   same_subject_one  — canonical_subject_id commun, une seule active (déterministe)
 *   same_subject_many — canonical_subject_id commun, plusieurs actives (ambigu)
 *   previous_version  — aucun lien exploitable (canonical_subject_id NULL ou 0 active)
 *
 * superseded_by reste prioritaire : c'est la seule vraie relation de filiation.
 * canonical_subject_id établit une identité de sujet, pas de filiation proposition→proposition.
 */
export type SupersededRelation =
  | { kind: 'replaced_by';       title: string }
  | { kind: 'same_subject_one';  title: string }
  | { kind: 'same_subject_many'; count: number; titles: string[] }
  | { kind: 'previous_version' }

export function resolveSupersededRelation(
  proposal: DbKnowledgeProposal,
  activeTitleById: Map<string, string>,
  activeByCanonicalSubject: Map<string, DbKnowledgeProposal[]>,
): SupersededRelation {
  // Niveau 1 : FK superseded_by explicite
  if (proposal.superseded_by) {
    const title = activeTitleById.get(proposal.superseded_by)
    if (title) return { kind: 'replaced_by', title }
  }

  // Niveau 2 : même canonical_subject_id
  if (proposal.canonical_subject_id) {
    const matches = activeByCanonicalSubject.get(proposal.canonical_subject_id) ?? []
    if (matches.length === 1) return { kind: 'same_subject_one', title: matches[0].title }
    if (matches.length > 1)  return { kind: 'same_subject_many', count: matches.length, titles: matches.map((m) => m.title) }
  }

  // Niveau 3 : aucun lien exploitable
  return { kind: 'previous_version' }
}

/** Construit l'index canonical_subject_id → propositions actives, utilisé par resolveSupersededRelation. */
export function buildActiveByCanonicalSubject(
  active: DbKnowledgeProposal[],
): Map<string, DbKnowledgeProposal[]> {
  const map = new Map<string, DbKnowledgeProposal[]>()
  for (const p of active) {
    if (!p.canonical_subject_id) continue
    const list = map.get(p.canonical_subject_id)
    if (list) list.push(p)
    else map.set(p.canonical_subject_id, [p])
  }
  return map
}
