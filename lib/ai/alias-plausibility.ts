// Q5 — plausibilité structurelle d'un `transcription_alias` (Vincent,
// 2026-08-18), après P0-1 (Q4.5) : depuis que seul `transcription_alias`
// réécrit le transcript, confirmer un mauvais `transcription_alias` a un
// pouvoir de réécriture réel. Ce module juge si la paire alias → cible est
// structurellement plausible AVANT confirmation.
//
// Réutilise EXACTEMENT les primitives de `normalizeTranscript` (compact,
// levenshtein, maxDistanceFor, STOP_WORDS) plutôt qu'une seconde
// implémentation : la plausibilité d'un alias doit se juger avec le même
// rapprochement que celui qui décidera un jour de réécrire, pas un autre.
//
// Trois niveaux, jamais recombinés :
//   normal     — recouvrement structurel fort avec la cible (ex. « Vincent
//                Millon » → « Vincent Milon », « Cégélec » → « CEGELEC »).
//   reinforced — aucun recouvrement clair (ex. « Bessie » → « BECIB »,
//                « imbécile » → « BECIB ») : pas de dictionnaire fiable pour
//                distinguer un nom propre francisé d'une insulte transcrite —
//                les deux tombent ici, sans exception.
//   refused    — alias uniquement composé de mots-outils, ou collision
//                exacte avec un AUTRE acteur connu du même périmètre :
//                jamais confirmable, geste explicite ou non.

import { compact, levenshtein, maxDistanceFor, normalize, STOP_WORDS } from '@/lib/ai/transcript-normalizer'

export type AliasPlausibilityLevel = 'normal' | 'reinforced' | 'refused'

export type AliasPlausibilityReason =
  | 'structural_overlap'
  | 'no_structural_overlap'
  | 'stopwords_only'
  | 'collision'

export type AliasPlausibilityResult = {
  level: AliasPlausibilityLevel
  reason: AliasPlausibilityReason
  /** Renseigné uniquement quand `reason === 'collision'`. */
  collidesWith?: string
}

/** Longueur compactée minimale en dessous de laquelle un containment ne prouve rien. */
const MIN_CONTAINMENT_LENGTH = 3

function isStopwordsOnly(alias: string): boolean {
  const tokens = normalize(alias).split(' ').filter(Boolean)
  if (tokens.length === 0) return true
  return tokens.every((t) => STOP_WORDS.has(t))
}

function findExactCollision(alias: string, otherKnownLabels: string[]): string | null {
  const normalizedAlias = normalize(alias)
  if (!normalizedAlias) return null
  for (const label of otherKnownLabels) {
    if (normalize(label) === normalizedAlias) return label
  }
  return null
}

function hasStrongStructuralOverlap(alias: string, targetLabel: string): boolean {
  const compactAlias = compact(alias)
  const compactTarget = compact(targetLabel)
  if (!compactAlias || !compactTarget) return false
  if (compactAlias === compactTarget) return true

  if (compactAlias.length >= MIN_CONTAINMENT_LENGTH && compactTarget.length >= MIN_CONTAINMENT_LENGTH) {
    if (compactTarget.includes(compactAlias) || compactAlias.includes(compactTarget)) return true
  }

  const tolerance = maxDistanceFor(compactTarget.length)
  return levenshtein(compactAlias, compactTarget) <= tolerance
}

/**
 * Juge la plausibilité d'une paire (alias entendu → acteur ciblé) pour un
 * `transcription_alias`. `otherKnownLabels` est le périmètre pertinent
 * (organisation) dans lequel chercher une collision exacte — vide côté UI
 * (pas d'accès DB), rempli côté écriture serveur (la vraie barrière, cf.
 * `confirmActorAlias`).
 */
export function evaluateTranscriptionAliasPlausibility(
  alias: string,
  targetLabel: string,
  otherKnownLabels: string[] = [],
): AliasPlausibilityResult {
  if (isStopwordsOnly(alias)) {
    return { level: 'refused', reason: 'stopwords_only' }
  }

  const collidesWith = findExactCollision(alias, otherKnownLabels)
  if (collidesWith) {
    return { level: 'refused', reason: 'collision', collidesWith }
  }

  if (hasStrongStructuralOverlap(alias, targetLabel)) {
    return { level: 'normal', reason: 'structural_overlap' }
  }

  return { level: 'reinforced', reason: 'no_structural_overlap' }
}
