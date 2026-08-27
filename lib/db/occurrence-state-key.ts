/**
 * P3-D1 — Déduplication « same-state » et clé d'état d'une occurrence.
 *
 * Doctrine (audit P3-C) : une occurrence n'est PLUS « le sujet apparaît dans ce rapport » mais
 * « un état/événement métier atomique daté du sujet ». Un même sujet peut donc avoir PLUSIEURS
 * occurrences dans un même rapport — mais UNIQUEMENT pour des états réellement distincts.
 *
 * Garde-fou central (Vincent) : NE PAS transformer « 1 proposition = 1 occurrence » (faux dans
 * 73/85 cas multi-proposition du corpus = reformulations/répétitions du MÊME état). La cible est :
 *   - plusieurs états distincts        → plusieurs occurrences ;
 *   - plusieurs preuves/reformulations → UNE occurrence (dédup same-state).
 *
 * Discriminateur d'état en D1 = `proposal_family`. Preuve corpus : les cas multi-état réels sont
 * tous CROSS-FAMILY (knowledge_fact « contrôlé/réalisé » = état constaté ; action/observation
 * « à faire/à refaire » = tâche/signal ouvert ; decision/deadline/reservation = leurs états propres),
 * tandis que les 73 reformulations sont SAME-FAMILY. Regrouper par famille sépare donc les vrais
 * états et dédoublonne les reformulations.
 *
 * Limite connue (assumée, documentée) : deux propositions de MÊME famille mais d'états réellement
 * distincts (ex. deux knowledge_fact « réalisé 2022 » + « à refaire ») dans un même rapport seraient
 * poolées par D1. Non observé dans le corpus ; à raffiner ultérieurement via le statut/polarité
 * (hors D1). D1 favorise la dédup (sous-split), symétrique de la doctrine « favoriser le faux négatif ».
 */

/** Familles de propositions qui portent un état/événement daté (éligibles aux occurrences). */
export type StateBearingFamily = 'action' | 'decision' | 'knowledge_fact' | 'deadline' | 'reservation' | 'observation'

/**
 * Clé d'état déterministe d'une occurrence, dérivée de la famille de proposition.
 * D1 : un état = une famille. Stable (rejeu identique) et non aléatoire.
 */
export function deriveStateKey(proposalFamily: string): string {
  return proposalFamily.trim().toLowerCase()
}

/**
 * Regroupe les propositions d'un même (sujet, rapport) par ÉTAT (state_key).
 * Chaque groupe = un état distinct → une occurrence. Les propositions d'un même groupe sont des
 * reformulations/preuves du même état → dédupliquées dans cette unique occurrence.
 *
 * Retourne une Map ordonnée par première apparition, pour un rejeu déterministe.
 */
export function groupPropositionsByState<T extends { proposal_family: string }>(
  proposals: T[],
): Map<string, T[]> {
  const byState = new Map<string, T[]>()
  for (const p of proposals) {
    const key = deriveStateKey(p.proposal_family)
    if (!byState.has(key)) byState.set(key, [])
    byState.get(key)!.push(p)
  }
  return byState
}

/**
 * R-1 — catégorie thématique d'UNE occurrence (groupe state_key). thematic_category classe le FAIT
 * (prouvé instable au niveau sujet : 34/134 sujets multi-catégories), donc portée par l'occurrence.
 *
 * Doctrine identique à `deriveOccurrenceStateStatus` : quand le modèle ne peut pas choisir sans
 * inventer, il n'invente pas. thematic_category ne pilote NI le tri-state NI la trajectoire (attribut
 * de restitution avec fallback `?? family`), donc aucun intérêt à fabriquer une catégorie arbitraire.
 *
 * - une seule catégorie non vide          → cette catégorie (univocal) ;
 * - plusieurs catégories dans le groupe    → null (conflict) — jamais une dominante arbitraire ;
 *   `distinct` conservé pour l'instrumentation (le conflit n'est jamais silencieux) ;
 * - aucune catégorie                       → null (none).
 */
export function deriveGroupThematicCategory(
  categories: (string | null)[],
): { category: string | null; reason: 'none' | 'univocal' | 'conflict'; distinct: string[] } {
  const counts = new Map<string, number>()
  for (const c of categories) {
    const t = (c ?? '').trim()
    if (t) counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  const distinct = [...counts.keys()].sort()
  if (distinct.length === 0) return { category: null, reason: 'none', distinct: [] }
  if (distinct.length === 1) return { category: distinct[0], reason: 'univocal', distinct }
  return { category: null, reason: 'conflict', distinct }
}
