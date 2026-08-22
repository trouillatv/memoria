// P0-1 — Normalisation de représentation pour la génération de candidats.
//
// RÔLE UNIQUE : produire une représentation invariante à l'état pour le
// matching Jaccard avant création d'un canonical_subject.
// NE DÉCIDE JAMAIS de la fusion — c'est analyzeSubjectPair (P0-2) qui décide.
//
// CONTRAT GELÉ (docs/memory-longitudinal-v1/P0-1-OCEF-IDENTITY-STATE-AUDIT.md §5, §9).
// Ne pas modifier les transformations sans mise à jour du sentinel.
//
// Transformations AUTORISÉES (démontrées sur corpus OCEF 2c939e67) :
//   1. Retirer le préfixe d'état « Prévision : » / « Prévisionnel(le) : »
//   2. Retirer les suffixes d'outcome : « = Fait », « = Réalisé(e)(s) »,
//      « - Travaux réalisés », « : X réalisé(s) » en fin de label,
//      clause « réalisé(e), ... » et clause « , reprise à faire ... »
//   3. Normaliser casse / ponctuation / ordre
//   4. Synonymie contrôlée : « Gestion des Eaux (GDE) » ↔ « GDE »
//   5. Neutraliser le préfixe catégoriel « Terrassement plateforme : »
//      sans supprimer le noyau
//
// Transformations INTERDITES :
//   - Retirer des dates (COLL-3, COLL-4)
//   - Retirer les numéros de lot (LOT01, LOT02)
//   - Réduire à un préfixe catégoriel seul (COLL-1, COLL-2)
//   - Retirer la conformité attachée à un événement daté (COLL-3)
//   - Normaliser les familles company / person (COLL-5)
//   - Retirer les localisations discriminantes (COLL-6)

/** Seuil Jaccard sur formes normalisées pour générer un candidat P0-1.
 *  Même valeur que JACCARD_THRESHOLD dans canonical-subject-resolve.ts :
 *  le filtrage des COLL provient du fait que les dates/objets restent dans
 *  la représentation normalisée (pas d'un seuil plus élevé). */
export const P01_NORMALIZED_JACCARD_THRESHOLD = 0.35

/**
 * Retourne une représentation de matching pour le label, invariante à l'état.
 * Le label original (stocké en DB) n'est JAMAIS modifié par cette fonction.
 *
 * @param label        - Label tel que stocké / produit par l'extraction.
 * @param proposalFamily - Famille de la proposition (company/person exclus, COLL-5).
 */
export function normalizeForMatching(label: string, proposalFamily?: string | null): string {
  // GUARD COLL-5 : entité acteur — ne jamais normaliser pour le matching
  // (« BECIB » company ≠ « BECIB est l'interlocuteur… » knowledge_fact)
  if (proposalFamily === 'company' || proposalFamily === 'person') {
    return normalizeBase(label)
  }

  let s = label.trim()

  // ── Famille 1 : préfixe d'état / tense ───────────────────────────────────
  // « Prévision : X » → « X »
  s = s.replace(/^Pr[eé]vision(?:nel(?:le)?)?\s*:\s*/i, '')

  // ── Famille 2 : suffixes d'outcome ───────────────────────────────────────
  // « X = Fait » → « X »
  s = s.replace(/\s*=\s*Fait\s*$/i, '')

  // « X = Réalisé(e)(s) » → « X »
  s = s.replace(/\s*=\s*R[eé]alis[eé]e?s?\s*$/i, '')

  // « X - Travaux réalisés » → « X »
  s = s.replace(/\s*-\s*Travaux\s+r[eé]alis[eé]e?s?\s*$/i, '')

  // « X : Y réalisé(s) » en fin — GARDE : ne pas toucher si Y contient une date
  // (ex: « Essais 20.02 Non Conformes » reste intact)
  s = s.replace(/\s*:\s*([^:]{1,80})\s+r[eé]alis[eé]e?s?\s*$/i, (match, inner: string) => {
    if (/\d{1,2}[./]\d{1,2}/.test(inner)) return match
    return ''
  })

  // « X réalisé(e)(s), clause d'état... » → « X »
  // Ex: « Récolement réalisé, reprise à faire sur zones hors tolérance » → « Récolement »
  s = s.replace(/\s*r[eé]alis[eé]e?s?\s*,.*$/i, '')

  // « X, reprise à faire... » → « X »
  s = s.replace(/\s*,\s*reprise\s+[aà]\s+faire\b.*$/i, '')

  // ── Famille 3 : forme — synonymie et préfixe catégoriel ──────────────────
  // « Gestion des Eaux (GDE) » → « GDE » / « Gestion des Eaux » → « GDE »
  s = s.replace(/Gestion\s+des\s+Eaux\s*\(GDE\)/gi, 'GDE')
  s = s.replace(/Gestion\s+des\s+Eaux(?!\s*\()/gi, 'GDE')

  // « Terrassement plateforme : X » → « X » (préfixe catégoriel, noyau conservé)
  s = s.replace(/^Terrassement\s+plateforme\s*:\s*/i, '')

  return normalizeBase(s)
}

function normalizeBase(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // retirer diacritiques
    .replace(/[^a-z0-9\s]/g, ' ')   // ponctuation → espace
    .replace(/\s+/g, ' ')
    .trim()
}
