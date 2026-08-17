// Extraction déterministe P4-D1 — RELATION_CLAIM (Vincent, 2026-08-17, mandat
// "GO P4-D1 uniquement").
//
// Le routeur (copilot-intent-router.ts) détecte SEULEMENT si la phrase contient
// un verbe relationnel explicite (booléen, sur texte normalisé). Cette
// extraction produit le contenu structuré du brouillon (relationType,
// sourceText, targetText) et opère sur le texte ORIGINAL (casse/accents
// préservés — sert aussi de preuve textuelle verbatim, invariant
// canonical_subject_link_evidence.evidence_text, mig 316).
//
// Cinq verbes reconnus, chacun mappé UN-À-UN sur le relation_type existant de
// canonical_subject_links (mig 316) — aucun nouveau type, "relates_to" reste
// interdit à la persistance :
//   dépend de / nécessite / requiert   → requires
//   permet                             → enables
//   valide                             → validates
//   cause / entraîne / provoque        → causes
//   remplace                           → replaces
//
// Hors périmètre (cadrage Vincent, audit P4-D, mig 327) : "s'occupe de"
// (acteur↔domaine, futur P4-B.3 distinct), "travaille chez" (affiliation),
// toute anaphore ("cette action", "ce document", futur P6) — aucun de ces
// verbes n'apparaît dans les patterns ci-dessous, par construction.

export type RelationClaimType = 'requires' | 'enables' | 'validates' | 'causes' | 'replaces'

export type RelationClaimExtraction = {
  relationType: RelationClaimType
  sourceText: string
  targetText: string
}

function stripTrailingPunctuation(text: string): string {
  return text.trim().replace(/[.!?]+$/, '').trim()
}

// Article de tête retiré avant résolution — même convention que
// extractQuestionSubjectPhrase (copilot-classify.ts) : "la mise sous tension"
// résout mieux vers le sujet canonical "Mise sous tension" sans l'article.
function stripLeadingArticle(text: string): string {
  return text.trim().replace(/^(?:le|la|les|l['’`])\s+/i, '').trim()
}

function clean(text: string): string {
  return stripLeadingArticle(stripTrailingPunctuation(text))
}

const REQUIRES_RE  = /^(.+?)\s+(?:d[ée]pend(?:ent)?\s+de|n[ée]cessite(?:nt)?|requiert|requi[èe]rent)\s+(.+)$/i
const ENABLES_RE   = /^(.+?)\s+permet(?:tent)?\s+(.+)$/i
const VALIDATES_RE = /^(.+?)\s+valide(?:nt)?\s+(.+)$/i
const CAUSES_RE    = /^(.+?)\s+(?:cause(?:nt)?|entra[îi]ne(?:nt)?|provoque(?:nt)?)\s+(.+)$/i
const REPLACES_RE  = /^(.+?)\s+remplace(?:nt)?\s+(.+)$/i

const PATTERNS: { type: RelationClaimType; re: RegExp }[] = [
  { type: 'requires',  re: REQUIRES_RE },
  { type: 'enables',   re: ENABLES_RE },
  { type: 'validates', re: VALIDATES_RE },
  { type: 'causes',    re: CAUSES_RE },
  { type: 'replaces',  re: REPLACES_RE },
]

/**
 * Extrait le type de relation + les deux syntagmes sujet (source/cible) depuis
 * le texte ORIGINAL de la question. Retourne null si aucun verbe relationnel
 * n'est trouvé (le routeur a déjà dû détecter RELATION_CLAIM pour qu'on arrive
 * ici — un null ici est un garde-fou de cohérence, pas un chemin attendu en
 * usage normal) ou si l'un des deux syntagmes est vide après nettoyage.
 */
export function extractRelationClaim(question: string): RelationClaimExtraction | null {
  const trimmed = question.trim()
  for (const { type, re } of PATTERNS) {
    const match = re.exec(trimmed)
    if (!match) continue
    const sourceText = clean(match[1])
    const targetText = clean(match[2])
    if (sourceText.length < 2 || targetText.length < 2) continue
    return { relationType: type, sourceText, targetText }
  }
  return null
}
