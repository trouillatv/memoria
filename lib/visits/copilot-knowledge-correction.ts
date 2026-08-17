// Extraction déterministe P5-F2b — CORRECTION_KNOWLEDGE (Vincent, 2026-08-17).
//
// Le routeur (copilot-intent-router.ts) détecte SEULEMENT si la phrase a la
// forme explicite d'une correction/obsolescence d'une information mémorisée
// (booléen, sur texte normalisé). Cette extraction distingue le MODE — même
// séparation que CORRECTION_IDENTITY (cf. copilot-identity-correction.ts) :
// détection normalisée dans le routeur, extraction sur texte ORIGINAL ici.
//
// Deux modes, quatre formes reconnues :
//   SUPERSESSION (nouvelle valeur remplace une ancienne) :
//     1. « Correction, … »                          → newTitle = reste de la phrase
//     2. « Ce n'est plus X, c'est Y »                → newTitle = phrase entière
//   ARCHIVAGE (information devenue caduque, sans valeur de remplacement) :
//     3. « Finalement… ne… plus… »
//     4. « Cette information n'est plus valable. »
//
// Volontairement PAS d'extraction fine de "juste la nouvelle valeur" (ex.
// isoler "5830" dans "Ce n'est plus 4812, c'est 5830") : la carte de
// confirmation reprend la phrase entière comme titre éditable par défaut,
// même philosophie que FactProposalCard — l'humain corrige avant de valider,
// pas de NLU fragile pour un gain marginal.

export type KnowledgeCorrectionExtraction =
  | { mode: 'supersede'; newTitle: string }
  | { mode: 'archive' }

function stripTrailingPunctuation(text: string): string {
  return text.trim().replace(/[.!?]+$/, '').trim()
}

const CORRECTION_PREFIX_RE = /^correction\s*[,:]?\s*/i
const CE_N_EST_PLUS_CEST_RE = /\bce\s+n['’`]?\s?est\s+plus\b.+\bc['’`]?\s?est\b/i
const FINALEMENT_NE_PLUS_RE = /\bfinalement\b.*\bne\s+\w+\s+plus\b/i
const N_EST_PLUS_VALABLE_RE = /\bn['’`]?\s?est\s+plus\s+valable\b/i

/**
 * Distingue supersession/archivage depuis le texte ORIGINAL de la question.
 * Retourne null si aucune des 4 formes ne matche (le routeur a déjà dû
 * détecter CORRECTION_KNOWLEDGE pour qu'on arrive ici — un null ici est un
 * garde-fou de cohérence, pas un chemin attendu en usage normal).
 */
export function extractKnowledgeCorrection(question: string): KnowledgeCorrectionExtraction | null {
  const trimmed = question.trim()

  if (CORRECTION_PREFIX_RE.test(trimmed) || CE_N_EST_PLUS_CEST_RE.test(trimmed)) {
    const newTitle = stripTrailingPunctuation(trimmed.replace(CORRECTION_PREFIX_RE, ''))
    return { mode: 'supersede', newTitle }
  }

  if (FINALEMENT_NE_PLUS_RE.test(trimmed) || N_EST_PLUS_VALABLE_RE.test(trimmed)) {
    return { mode: 'archive' }
  }

  return null
}
