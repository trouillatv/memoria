/**
 * P-UI-R2c — Génération de paires candidates de la VOIE SÉMANTIQUE.
 *
 * Complément (non substitut) au générateur lexical `generateCandidates` :
 * celui-ci ne produit que des paires lexicalement proches (Jaccard ≥ 0.2), donc
 * deux sujets qui désignent le même objet réel mais formulés différemment
 * (ex. « Dégagement du Mall » ↔ « Issue de secours du food court ») ne deviennent
 * jamais des suggestions. Ce module comble ce trou en proposant des paires
 * NON lexicales à faire trancher par le juge (`analyzeSubjectPair`).
 *
 * Doctrine (Vincent, P-UI-R2c) :
 * - INCRÉMENTAL : sources = sujets touchés par l'import courant ; cibles = sujets
 *   métier actifs du chantier. Jamais N×N sur tout le graphe.
 * - Aucun second moteur : le verdict reste celui d'`analyzeSubjectPair` ; ce module
 *   ne fait que CHOISIR les paires à lui soumettre.
 * - Exclusions strictes AVANT tout appel LLM : self, doublons A/B, paires déjà
 *   couvertes par la voie lexicale, déjà rejetées, déjà pending, déjà fusionnées/liées.
 *   (les acteurs sont exclus en amont : la voie sémantique ne reçoit que des
 *   business_subject — cf. loadSimilarityContextSubjects.)
 * - CAP DUR : si le nombre de paires candidates dépasse le cap, on SKIP tout
 *   (pairs=[], capped=true) et on journalise — jamais une avalanche d'appels LLM.
 *   Favoriser le faux négatif : mieux vaut ne rien proposer qu'inonder le juge.
 *
 * Fonction pure : testable sans DB ni LLM. Le vrai coût (LLM, contexte, persistance)
 * vit dans l'orchestrateur `runSemanticFeed`.
 */

import { normalizePairKey, normalizedPair } from './similarity-candidates'

/** Cap dur par défaut sur le nombre de paires candidates soumises au juge en un import. */
export const SEMANTIC_FEED_MAX_PAIRS = 60

export interface SemanticFeedInput {
  /** Sujets métier touchés par l'import courant (les seules sources autorisées). */
  sourceIds: string[]
  /** Sujets métier actifs du chantier (les cibles possibles). Les sources en font partie. */
  targetIds: string[]
  /**
   * Clés de paires (normalizePairKey) à NE PAS soumettre : union de
   * lexical-couvert ∪ rejeté ∪ pending ∪ accepté (merge/link). Idempotence + mémoire des refus.
   */
  excludedPairKeys?: Set<string>
  /** Cap dur ; au-delà, skip total. Défaut SEMANTIC_FEED_MAX_PAIRS. */
  cap?: number
}

export interface SemanticFeedPlan {
  /** Paires normalisées [a,b] (a<b) à soumettre au juge. Vide si capped. */
  pairs: Array<[string, string]>
  /** Nombre de paires candidates distinctes après exclusions, AVANT le cap. */
  evaluatedPairCount: number
  /** true → le cap a été dépassé : rien n'est soumis (skip sûr). */
  capped: boolean
}

/**
 * Construit l'ensemble déterministe des paires de la voie sémantique.
 *
 * Invariants :
 * - jamais (x,x) ; jamais deux fois la même paire (dédup par clé normalisée) ;
 * - jamais une paire présente dans excludedPairKeys ;
 * - au moins une extrémité est une source (par construction sources × cibles) ;
 * - si evaluatedPairCount > cap → pairs=[] et capped=true (aucune paire soumise).
 */
export function buildSemanticFeedPairs(input: SemanticFeedInput): SemanticFeedPlan {
  const excluded = input.excludedPairKeys ?? new Set<string>()
  const cap = input.cap ?? SEMANTIC_FEED_MAX_PAIRS
  const targets = input.targetIds

  const seen = new Set<string>()
  const pairs: Array<[string, string]> = []

  for (const sourceId of input.sourceIds) {
    for (const targetId of targets) {
      if (sourceId === targetId) continue
      const key = normalizePairKey(sourceId, targetId)
      if (excluded.has(key)) continue
      if (seen.has(key)) continue
      seen.add(key)
      pairs.push(normalizedPair(sourceId, targetId))
    }
  }

  const evaluatedPairCount = seen.size
  if (evaluatedPairCount > cap) {
    return { pairs: [], evaluatedPairCount, capped: true }
  }
  return { pairs, evaluatedPairCount, capped: false }
}
