// Extraction déterministe P4-B.2 — CORRECTION_IDENTITY (Vincent, 2026-08-17).
//
// Le routeur (copilot-intent-router.ts) détecte SEULEMENT si la phrase a la
// forme d'une correction d'identité (booléen, sur texte normalisé). Cette
// extraction produit le contenu structuré du brouillon (alias, cible, nature
// proposée) et DOIT opérer sur le texte ORIGINAL (casse, accents, virgules
// préservés pour l'affichage) — normalizeQuery() du routeur supprime les
// virgules, ce qui casserait la lecture "X, c'est Y de Z".
//
// Cinq formes reconnues, essayées dans cet ordre :
//   1. « Quand je dis X, je parle de Y. »                    → transcription_alias
//   2. « X, c'est Y de Z. » (qualifiée par une organisation)  → business_alias
//   3. « Non, X c'est Y. »                                    → transcription_alias
//   4. « On appelle aussi X, Y. »                              → business_alias
//   5. « X, c'est Y. » (forme nue, sans "de Z")                → business_alias
//
// La nature proposée n'est qu'une PROPOSITION affichée dans le brouillon —
// l'utilisateur la confirme ou la corrige avant écriture (mig 327, alias_nature).
// Faux positif connu et accepté : une phrase générique en "X, c'est Y" sans
// rapport avec un acteur (ex. « Le plan, c'est de refaire la dalle. ») peut
// matcher la forme 5 ; resolveActorTarget() renverra alors not_found — coût
// borné à une clarification inutile, jamais une écriture erronée.
//
// Formes 4 et 5 (Vincent, 2026-08-17) — deux choix délibérés à noter :
//   - Forme 4, « on appelle X Y » = grammaticalement « X est appelé Y » (comme
//     « on appelle ce chien Rex ») : X est l'objet déjà connu (target), Y le
//     nom qu'on lui donne (alias). Ordre INVERSÉ par rapport aux formes 1-3
//     (où le premier segment est l'alias) — pas une incohérence, c'est le sens
//     du verbe "appeler" à complément double qui l'impose.
//   - Forme 5 garde alias=premier segment / target=second segment, PAR
//     COHÉRENCE avec les formes 1-3 (le premier segment est ce qui a été
//     entendu, le second ce que ça désigne réellement) — c'est le sens
//     symétrique de "c'est" qui laisse ce choix ouvert, donc on aligne sur
//     l'existant plutôt que de créer une 2ᵉ convention pour un simple "c'est".

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
const ON_APPELLE_RE = /^on\s+appelle\s+aussi\s+(.+?)\s*,\s*(.+)$/i
const PLAIN_CEST_RE = /^(.+?)\s*,\s*c['’`]?\s?est\s+(.+)$/i

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

  const onAppelleMatch = ON_APPELLE_RE.exec(trimmed)
  if (onAppelleMatch) {
    return {
      alias: stripTrailingPunctuation(onAppelleMatch[2]),
      target: stripTrailingPunctuation(onAppelleMatch[1]),
      targetOrg: null,
      proposedNature: 'business_alias',
    }
  }

  const plainCestMatch = PLAIN_CEST_RE.exec(trimmed)
  if (plainCestMatch) {
    return {
      alias: stripTrailingPunctuation(plainCestMatch[1]),
      target: stripTrailingPunctuation(plainCestMatch[2]),
      targetOrg: null,
      proposedNature: 'business_alias',
    }
  }

  return null
}
