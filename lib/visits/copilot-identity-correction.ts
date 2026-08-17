// Extraction déterministe P4-B.2 — CORRECTION_IDENTITY (Vincent, 2026-08-17).
//
// Le routeur (copilot-intent-router.ts) détecte SEULEMENT si la phrase a la
// forme d'une correction d'identité (booléen, sur texte normalisé). Cette
// extraction produit le contenu structuré du brouillon (alias, cible, nature
// proposée) et DOIT opérer sur le texte ORIGINAL (casse, accents, virgules
// préservés pour l'affichage) — normalizeQuery() du routeur supprime les
// virgules, ce qui casserait la lecture "X, c'est Y de Z".
//
// Trois formes reconnues, essayées dans cet ordre :
//   1. « Quand je dis X, je parle de Y. »                    → transcription_alias
//   2. « X, c'est Y de Z. » (qualifiée par une organisation)  → business_alias
//   3. « Non, X c'est Y. »                                    → transcription_alias
//
// La nature proposée n'est qu'une PROPOSITION affichée dans le brouillon —
// l'utilisateur la confirme ou la corrige avant écriture (mig 327, alias_nature).
// Faux positif connu et accepté : une phrase générique en "X, c'est Y" sans
// rapport avec un acteur (ex. « Le plan, c'est de refaire la dalle. ») peut
// matcher la forme 2/3 ; resolveActorTarget() renverra alors not_found — coût
// borné à une clarification inutile, jamais une écriture erronée.

export type IdentityCorrectionExtraction = {
  alias: string
  target: string
  targetOrg: string | null
  proposedNature: 'business_alias' | 'transcription_alias'
}

function stripTrailingPunctuation(text: string): string {
  return text.trim().replace(/[.!?]+$/, '').trim()
}

const QUAND_RE = /quand\s+je\s+dis\s+(.+?)\s*,?\s*je\s+parle\s+de\s+(.+)$/i
const DE_RE = /^(.+?)\s*,?\s*c['’`]?\s?est\s+(.+?)\s+de\s+(.+)$/i
const NON_RE = /^non\s*,?\s*(.+?)\s+c['’`]?\s?est\s+(.+)$/i

/**
 * Extrait alias/cible/nature depuis le texte ORIGINAL de la question.
 * Retourne null si aucune des 3 formes ne matche (le routeur a déjà dû
 * détecter CORRECTION_IDENTITY pour qu'on arrive ici — un null ici est un
 * garde-fou de cohérence, pas un chemin attendu en usage normal).
 */
export function extractIdentityCorrection(question: string): IdentityCorrectionExtraction | null {
  const trimmed = question.trim()

  const quandMatch = QUAND_RE.exec(trimmed)
  if (quandMatch) {
    return {
      alias: stripTrailingPunctuation(quandMatch[1]),
      target: stripTrailingPunctuation(quandMatch[2]),
      targetOrg: null,
      proposedNature: 'transcription_alias',
    }
  }

  const deMatch = DE_RE.exec(trimmed)
  if (deMatch) {
    return {
      alias: stripTrailingPunctuation(deMatch[1]),
      target: stripTrailingPunctuation(deMatch[2]),
      targetOrg: stripTrailingPunctuation(deMatch[3]),
      proposedNature: 'business_alias',
    }
  }

  const nonMatch = NON_RE.exec(trimmed)
  if (nonMatch) {
    return {
      alias: stripTrailingPunctuation(nonMatch[1]),
      target: stripTrailingPunctuation(nonMatch[2]),
      targetOrg: null,
      proposedNature: 'transcription_alias',
    }
  }

  return null
}
