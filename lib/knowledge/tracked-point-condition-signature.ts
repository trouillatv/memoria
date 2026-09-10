import 'server-only'

// P6 — signature de condition métier, portée depuis scripts/_p5b6-signature.ts (dry-run,
// jamais branché en production). Sert UNIQUEMENT à élargir la décision de membership au-delà
// du containment lexical strict (tracked-point-membership-candidates.ts), quand deux libellés
// désignent potentiellement la même situation qui évolue (reformulation, nouvelle étape).
//
// Déviation assumée par rapport au script source, documentée pour revue (mandat Vincent,
// « raccordement du rail V2 d'identité Point ») :
//   1. L'ancre est dérivée du LABEL de l'item lui-même (candidat ou Point), jamais de
//      `subjectLabel`. Vérifié à la main sur le témoin R7 (CR011→CR012) : le sujet canonique
//      du candidat CR012 ("Surveillance des fissures du Regard R7") et celui du Point CR011
//      ("Assainissement sous plateforme...") ne partagent aucun token (singulier/pluriel non
//      normalisé par `normalizeLabel`), ce qui aurait produit un anchorOverlap=0 et bloqué la
//      comparaison avant même d'atteindre le juge — alors que les deux LABELS mentionnent tous
//      les deux "Regard R7". Le sujet canonique est précisément le signal dont on cherche à
//      s'affranchir ici, pas une source fiable d'ancrage.
//   2. Aucun secours LLM n'est câblé dans la dérivation de signature elle-même (contrairement
//      à `deriveSignatureLlm`/`deriveSignature` du script source) : le seul appel LLM de la
//      chaîne V2 de production est le juge d'identité Q1/Q2 (tracked-point-identity-widening.ts),
//      pour les cas réellement ambigus — pas un deuxième appel pour raffiner la signature
//      elle-même. Conforme à la doctrine « déterministe d'abord, LLM seulement en secours
//      ambigu » appliquée à la CHAÎNE, sans la dupliquer à l'intérieur de chaque primitive.
//   3. `scope` et `resolutionCriterion` (présents dans le script source) sont abandonnés : non
//      consommés par `compareSignatures`, qui ne compare que `anchor` et `trackedCondition`.

import { normalizeLabel, stripCategoryFormatting } from '@/lib/documents/subject-reconciliation'

export type ConditionSignature = {
  anchor: string
  trackedCondition: string
}

/**
 * Dérivation purement déterministe, sans appel réseau. `anchor` = label complet normalisé ;
 * `trackedCondition` = label normalisé après retrait du formatage de catégorie
 * (`stripCategoryFormatting`, prédicat gelé réutilisé tel quel). Pour la plupart des libellés
 * (sans préfixe de catégorie), les deux coïncident — `compareSignatures` se comporte alors comme
 * un simple Jaccard sur les tokens du label, ce qui suffit à distinguer DISTINCT (aucun
 * recouvrement) de AMBIGUOUS (recouvrement partiel, à arbitrer par le juge).
 */
export function deriveConditionSignature(label: string): ConditionSignature {
  return {
    anchor: normalizeLabel(label),
    trackedCondition: normalizeLabel(stripCategoryFormatting(label)),
  }
}

export function tokenSet(s: string): Set<string> {
  return new Set(s.split(' ').filter(Boolean))
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  const inter = [...a].filter((x) => b.has(x)).length
  const union = new Set([...a, ...b]).size
  return union === 0 ? 0 : inter / union
}

export type SignatureComparison = {
  anchorOverlap: number
  conditionOverlap: number
  deterministic: 'SAME' | 'DISTINCT' | 'AMBIGUOUS'
}

/**
 * Comparaison déterministe, portée telle quelle depuis _p5b6-signature.ts (seuils inchangés) :
 * - anchorOverlap = 0 → DISTINCT (aucune ancre commune, même élargie).
 * - anchorOverlap >= 0.5 ET conditionOverlap >= 0.6 → SAME.
 * - sinon → AMBIGUOUS (le rail déterministe ne tranche pas, juge d'identité requis).
 */
export function compareSignatures(a: ConditionSignature, b: ConditionSignature): SignatureComparison {
  const anchorOverlap = jaccard(tokenSet(a.anchor), tokenSet(b.anchor))
  const conditionOverlap = jaccard(tokenSet(a.trackedCondition), tokenSet(b.trackedCondition))

  if (anchorOverlap === 0) return { anchorOverlap, conditionOverlap, deterministic: 'DISTINCT' }
  if (anchorOverlap >= 0.5 && conditionOverlap >= 0.6) return { anchorOverlap, conditionOverlap, deterministic: 'SAME' }
  return { anchorOverlap, conditionOverlap, deterministic: 'AMBIGUOUS' }
}
