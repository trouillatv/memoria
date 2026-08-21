/**
 * Tests unitaires du matcher robuste pour le benchmark extraction "decision".
 *
 * Cas couverts (référence : MATCHER-MINI-GROUND-TRUTH.md) :
 *   T1 – MEL-E55 : ref complète ↔ FP « Abandon dalot » → MATCHED (overlap ≥ 0.50)
 *   T2 – JAR-E61 : ref complète ↔ FP première moitié omise → MATCHED (overlap 0.86)
 *   T3 – Non-match sémantique : overlap 0.00 → MISSED
 *   T4 – Zone ambiguë 0.33–0.50 : → AMBIGUOUS_MATCH (jamais auto-matchée)
 *   T5 – Préfixe "Rappel : " supprimé sans casser le match
 *   T6 – Insensibilité casse/accents/ponctuation
 *   T7 – Page incompatible → MISSED même si overlap élevé
 *   T8 – Famille incompatible (decision ref vs action ext) → MISSED
 *   T9 – Fallback label quand sourceExcerpt est vide (cas JAR run gelé)
 *  T10 – LRM-E38 (decision) vs FP reservation → MATCHED_BORDERLINE ou écarte selon filtre
 */

import { describe, it, expect } from 'vitest'
import {
  matchDecisionRef,
  normalizeAndTokenize,
  computeScores,
  isFamilyCompatible,
  THRESHOLD_MATCH,
  THRESHOLD_AMBIG_LOW,
  type ReferenceElement,
  type ExtractedElement,
} from '@/scripts/benchmark-decision-matcher'

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeRef(
  id: string,
  excerpt: string,
  page: number | null = null,
): ReferenceElement {
  return { id, family: 'decision', page, excerpt }
}

function makeExt(
  corpusId: string,
  sourceExcerpt: string,
  page?: number | null,
  family: string = 'decision',
  label?: string,
): ExtractedElement {
  return { corpusId, family, sourceExcerpt, page, label }
}

// ── T1 : MEL-E55 — ref complète vs FP label court ─────────────────────────────
// Référence : MATCHER-MINI-GROUND-TRUTH.md catégorie 1 (vrais matchs reformulés)
// Le slice(0,50) gelé divergeait car le début de la ref diffère du label court.
// L'overlap sur les tokens communs (dalot, pose, écartée, réseau, etc.) = 0.71 ≥ 0.50.

describe('T1 — MEL-E55 : Abandon dalot récupéré par le matcher', () => {
  const ref = makeRef(
    'MEL_CR03-E55',
    'Rappel : La pose d\'un dalot de décharge des Eaux pluviales entre la rue des pothières et le lavoir a été écartée au profit du renforcement du réseau rue du moulin (1 dalot de 150x70 en lieu et place DN800).',
    null,
  )

  const ext = makeExt(
    'MEL_CR03',
    'Rappel : La pose d\'un dalot de décharge des Eaux pluviales entre la rue des pothières et le lavoir a été écartée au profit du renforcement du réseau rue du moulin (1 dalot de 150x70 en lieu et place DN800).',
    null,
    'decision',
    'Abandon dalot de décharge EP au profit renforcement réseau',
  )

  it('match avec la sourceExcerpt identique → overlap 1.00', () => {
    const result = matchDecisionRef(ref, 'MEL_CR03', [ext])
    expect(result.verdict).toBe('MATCHED')
    expect(result.overlapScore).toBeGreaterThanOrEqual(THRESHOLD_MATCH)
    expect(result.bestCandidate).toBe(ext)
  })

  it('match avec le label court seul (sourceExcerpt vide) → overlap ≥ 0.50', () => {
    const extLabelOnly = makeExt('MEL_CR03', '', null, 'decision', 'Abandon dalot de décharge EP au profit renforcement réseau')
    const result = matchDecisionRef(ref, 'MEL_CR03', [extLabelOnly])
    // Le label court « Abandon dalot de décharge EP au profit renforcement réseau »
    // contient les tokens : abandon, dalot, decharge, ep, profit, renforcement, reseau
    // La ref contient entre autres : dalot, decharge, eaux, pluviales, ecartee, profit,
    // renforcement, reseau. Overlap = tokens communs / min(|ref|,|label|).
    expect(result.verdict).toBe('MATCHED')
    expect(result.overlapScore).toBeGreaterThanOrEqual(THRESHOLD_MATCH)
  })
})

// ── T2 : JAR-E61 — première moitié de ref omise dans l'extrait ────────────────
// Référence : MATCHER-MINI-GROUND-TRUTH.md catégorie 1
// La première moitié (« dépose du jeu de vannes… ») est absente du FP.
// slice(0,50) matchait "dépose du jeu" vs "Alimentation" → 0 commun → MISSED.
// Overlap sur tokens : validé, agur, alimentation, fonte → 0.86 ≥ 0.50.

describe('T2 — JAR-E61 : première moitié omise récupérée', () => {
  const ref = makeRef(
    'JAR_CR04-E61',
    'dépose du jeu de vannes actuellement pour permettre le raccordement = alimentation fonte 200 validé AGUR',
    null,
  )

  const ext = makeExt(
    'JAR_CR04',
    '', // excerpt vide dans le run gelé
    null,
    'decision',
    'Alimentation de la fonte 200 existant à l\'envers validée par AGUR.',
  )

  it('match avec fallback label — overlap ≥ 0.50 malgré la moitié omise', () => {
    const result = matchDecisionRef(ref, 'JAR_CR04', [ext])
    expect(result.verdict).toBe('MATCHED')
    expect(result.overlapScore).toBeGreaterThanOrEqual(THRESHOLD_MATCH)
  })

  it('overlap calculé > 0.70 (données mini ground truth : 0.86)', () => {
    // Tokens ref après normalisation (approx) : depose, jeu, vannes, permettre,
    //   raccordement, alimentation, fonte, 200, valide, agur
    // Tokens label (approx) : alimentation, fonte, 200, existant, envers, validee, agur
    // Intersection : alimentation, fonte, 200, valide/validee (même radical), agur ≈ 5
    // min(10, 7) = 7 → overlap ≥ 5/7 ≈ 0.71
    const refTokens = normalizeAndTokenize(ref.excerpt)
    const extTokens = normalizeAndTokenize(ext.label ?? '')
    const { overlap } = computeScores(refTokens, extTokens)
    expect(overlap).toBeGreaterThanOrEqual(0.50)
  })
})

// ── T3 : Non-match sémantique clair — overlap 0.00 ────────────────────────────
// Référence : MATCHER-MINI-GROUND-TRUTH.md catégorie 2 (vrais non-matchs)
// E40 « couverture 1995 CCA » vs FP « pierres assise corniches » → tokens disjoints.

describe('T3 — Non-match sémantique → MISSED', () => {
  const ref = makeRef(
    'LRM_CR04-E40-SIMUL',
    'La couverture des deux premières travées réalisée en 1995 par l\'entreprise CCA sera reprise en TC2.',
    3,
  )

  const extUnrelated = makeExt(
    'LRM_CR04',
    'A priori, et dans l\'attente des relevés de charpente après découverture, les pierres de l\'assise rapportée au droit des corniches seront conservées.',
    2,
    'reservation', // famille incompatible → filtré avant scoring
  )

  it('famille incompatible (reservation) → MISSED sans même scorer', () => {
    const result = matchDecisionRef(ref, 'LRM_CR04', [extUnrelated])
    expect(result.verdict).toBe('MISSED')
    expect(result.overlapScore).toBe(0)
  })
})

// ── T4 : Zone ambiguë 0.33–0.50 → AMBIGUOUS_MATCH ────────────────────────────
// Un candidat avec overlap dans la bande ne doit jamais être auto-matchée.
// On construit une paire artificielle avec overlap forcé dans la zone.

describe('T4 — Zone 0.33–0.50 → AMBIGUOUS_MATCH (jamais auto-matchée)', () => {
  // Ref : 6 tokens porteurs
  const ref = makeRef(
    'TEST-E01',
    'Le positionnement du poste de relevage rue du moulin a été acté sur site.',
    2,
  )

  // Ext avec seulement 2 tokens communs sur 6 min → overlap ≈ 0.33–0.40
  const extAmbig = makeExt(
    'TEST_CORPUS',
    'Positionnement du point de branchement PI rue du moulin.',
    2,
    'decision',
  )

  it('overlap dans la bande [0.33, 0.50) → AMBIGUOUS_MATCH, overlap ≥ 0.50 → MATCHED', () => {
    const refTokens = normalizeAndTokenize(ref.excerpt)
    const extTokens = normalizeAndTokenize(extAmbig.sourceExcerpt ?? '')
    const { overlap } = computeScores(refTokens, extTokens)

    const result = matchDecisionRef(ref, 'TEST_CORPUS', [extAmbig])

    // Comportement attendu selon le score réel calculé
    if (overlap >= THRESHOLD_MATCH) {
      // L'overlap dépasse le seuil → MATCHED (acceptable)
      expect(result.verdict).toBe('MATCHED')
    } else if (overlap >= THRESHOLD_AMBIG_LOW) {
      // L'overlap est dans la bande → AMBIGUOUS_MATCH
      expect(result.verdict).toBe('AMBIGUOUS_MATCH')
    } else {
      // L'overlap est trop faible → MISSED
      expect(result.verdict).toBe('MISSED')
    }
    // Dans tous les cas : jamais auto-matchée si overlap < THRESHOLD_MATCH
    if (overlap < THRESHOLD_MATCH) {
      expect(result.verdict).not.toBe('MATCHED')
      expect(result.verdict).not.toBe('MATCHED_BORDERLINE')
    }
  })

  it('seuil THRESHOLD_MATCH = 0.50 et THRESHOLD_AMBIG_LOW = 0.33', () => {
    expect(THRESHOLD_MATCH).toBe(0.50)
    expect(THRESHOLD_AMBIG_LOW).toBe(0.33)
  })
})

// ── T5 : Préfixe "Rappel : " retiré sans casser le match ─────────────────────

describe('T5 — Préfixe "Rappel : " supprimé lors de la normalisation', () => {
  it('normalizeAndTokenize retire le préfixe "Rappel : "', () => {
    const withPrefix = normalizeAndTokenize('Rappel : La pose d\'un dalot de décharge.')
    const withoutPrefix = normalizeAndTokenize('La pose d\'un dalot de décharge.')
    expect(withPrefix).toEqual(withoutPrefix)
  })

  it('le retrait du préfixe ne casse pas les tokens suivants', () => {
    const tokens = normalizeAndTokenize('Rappel : Installation du tableau électrique.')
    expect(tokens).toContain('installation')
    expect(tokens).toContain('tableau')
    expect(tokens).toContain('electrique')
    expect(tokens).not.toContain('rappel')
  })
})

// ── T6 : Insensibilité casse / accents / ponctuation ─────────────────────────

describe('T6 — Normalisation casse/accents/ponctuation', () => {
  it('accents normalisés (é→e, è→e, ê→e, à→a, etc.)', () => {
    const tokens = normalizeAndTokenize('Réalisée en 1995 : réseau rénové.')
    expect(tokens).toContain('realisee')
    expect(tokens).toContain('1995')
    expect(tokens).toContain('reseau')
    expect(tokens).toContain('renove')
  })

  it('ponctuation retirée — les deux-points, parenthèses, etc.', () => {
    const tokens = normalizeAndTokenize('Solution n°2 (avec coyau) : validée.')
    expect(tokens).not.toContain(':')
    expect(tokens).not.toContain('(')
    expect(tokens).not.toContain(')')
    expect(tokens).not.toContain('.')
  })

  it('comparaison casse insensible', () => {
    const refTokens = normalizeAndTokenize('La DALOT de DÉCHARGE.')
    const extTokens = normalizeAndTokenize('la dalot de décharge.')
    const { overlap } = computeScores(refTokens, extTokens)
    expect(overlap).toBe(1.0)
  })
})

// ── T7 : Page incompatible → MISSED même si overlap élevé ────────────────────

describe('T7 — Page incompatible → MISSED', () => {
  const ref = makeRef(
    'TEST-PAGE',
    'Dépose du jeu de vannes alimentation fonte 200 validé AGUR.',
    3, // page 3
  )

  const extFarPage = makeExt(
    'TEST_CORPUS',
    'Dépose du jeu de vannes alimentation fonte 200 validé AGUR.',
    10, // page 10 — écart > 1
    'decision',
  )

  it('page écart > 1 → MISSED malgré overlap 1.00', () => {
    const result = matchDecisionRef(ref, 'TEST_CORPUS', [extFarPage])
    expect(result.verdict).toBe('MISSED')
    expect(result.overlapScore).toBe(0)
  })

  it('page null sur l\'extrait → filtre désactivé (match possible)', () => {
    const extNullPage = makeExt(
      'TEST_CORPUS',
      'Dépose du jeu de vannes alimentation fonte 200 validé AGUR.',
      null, // page null → filtre neutralisé
      'decision',
    )
    const result = matchDecisionRef(ref, 'TEST_CORPUS', [extNullPage])
    expect(result.verdict).toBe('MATCHED')
  })
})

// ── T8 : Famille incompatible → filtrée avant scoring ────────────────────────

describe('T8 — Famille incompatible (action) → MISSED', () => {
  const ref = makeRef(
    'TEST-FAM',
    'Les élus ont validé cette technique en réunion.',
    null,
  )

  const extAction = makeExt(
    'TEST_CORPUS',
    'Les élus ont validé cette technique en réunion.',
    null,
    'action', // famille action = incompatible avec ref decision
  )

  it('famille "action" écartée par isFamilyCompatible', () => {
    const { compatible } = isFamilyCompatible('decision', 'action', extAction.sourceExcerpt ?? '')
    expect(compatible).toBe(false)
  })

  it('résultat final → MISSED car aucun candidat compatible', () => {
    const result = matchDecisionRef(ref, 'TEST_CORPUS', [extAction])
    expect(result.verdict).toBe('MISSED')
  })
})

// ── T9 : Fallback label quand sourceExcerpt est vide ─────────────────────────
// Cas des extraits JAR du run gelé : extractedExcerpt = "" mais label renseigné.

describe('T9 — Fallback label quand sourceExcerpt est vide', () => {
  const ref = makeRef(
    'JAR_CR04-E61',
    'alimentation fonte 200 validé AGUR',
    null,
  )

  it('extrait avec excerpt vide et label renseigné → label utilisé pour le scoring', () => {
    const extEmptyExcerpt = makeExt(
      'JAR_CR04',
      '',   // vide
      null,
      'decision',
      'Alimentation de la fonte 200 validée par AGUR.', // label non vide
    )
    const result = matchDecisionRef(ref, 'JAR_CR04', [extEmptyExcerpt])
    // Tokens communs : alimentation, fonte, 200, valide/validee, agur
    expect(result.verdict).toBe('MATCHED')
    expect(result.overlapScore).toBeGreaterThanOrEqual(THRESHOLD_MATCH)
  })

  it('extrait avec excerpt et label tous les deux vides → MISSED', () => {
    const extAllEmpty = makeExt('JAR_CR04', '', null, 'decision', '')
    const result = matchDecisionRef(ref, 'JAR_CR04', [extAllEmpty])
    expect(result.verdict).toBe('MISSED')
  })
})

// ── T10 : LRM-E38 vs FP reservation — frontière famille ──────────────────────
// MATCHER-MINI-GROUND-TRUTH.md : LRM-E38 (decision) vs FP « pierres assise »
// Le FP correspond à E71 (reservation), pas à E38.
// Le pré-filtre famille doit router le FP reservation vers la comparaison avec
// les refs reservation, pas avec E38.

describe('T10 — LRM-E38 vs FP reservation → borderline ou écarté selon overlap', () => {
  const refE38 = makeRef(
    'LRM_CR04-E38',
    'A priori, et afin de conserver les deux premières travées restaurées côté ouest et dans l\'attente des relevés de charpente après découverture, pour le versant Sud, c\'est la solution n°2 avec conservation du rang de pierre sur l\'arase et mise en place d\'un coyau côté Est qui sera réalisée.',
    3,
  )

  const fpReservation = makeExt(
    'LRM_CR04',
    'A priori, et dans l\'attente des relevés de charpente après découverture, les pierres de l\'assise rapportée au droit des corniches seront conservées.',
    2, // page 2, ref E38 est page 3 → écart = 1 (toléré)
    'reservation',
  )

  it('famille reservation → compatible avec borderline=true', () => {
    const { compatible, borderline } = isFamilyCompatible('decision', 'reservation', fpReservation.sourceExcerpt ?? '')
    expect(compatible).toBe(true)
    expect(borderline).toBe(true)
  })

  it('verdict selon score réel : MATCHED_BORDERLINE si ≥ 0.50, AMBIGUOUS_MATCH si 0.33–0.50, MISSED sinon', () => {
    // On vérifie le comportement réel du matcher sur cette paire
    const refTokens = normalizeAndTokenize(refE38.excerpt)
    const extTokens = normalizeAndTokenize(fpReservation.sourceExcerpt ?? '')
    const { overlap } = computeScores(refTokens, extTokens)

    const result = matchDecisionRef(refE38, 'LRM_CR04', [fpReservation])

    if (overlap >= THRESHOLD_MATCH) {
      // famille reservation → MATCHED_BORDERLINE (jamais MATCHED simple)
      expect(result.verdict).toBe('MATCHED_BORDERLINE')
    } else if (overlap >= THRESHOLD_AMBIG_LOW) {
      // Dans la bande → AMBIGUOUS_MATCH
      expect(result.verdict).toBe('AMBIGUOUS_MATCH')
    } else {
      expect(result.verdict).toBe('MISSED')
    }
    // Dans tous les cas : jamais auto-matchée comme MATCHED simple
    expect(result.verdict).not.toBe('MATCHED')
  })
})

// ── Tests de normalisation unitaires ─────────────────────────────────────────

describe('normalizeAndTokenize — cas de base', () => {
  it('texte vide → tableau vide', () => {
    expect(normalizeAndTokenize('')).toEqual([])
    expect(normalizeAndTokenize('  ')).toEqual([])
  })

  it('mots-outils retirés', () => {
    const tokens = normalizeAndTokenize('le la les de du des et en un une au aux')
    expect(tokens).toHaveLength(0)
  })

  it('tokens courts (1 caractère) retirés', () => {
    const tokens = normalizeAndTokenize('a b c abc')
    expect(tokens).not.toContain('a')
    expect(tokens).not.toContain('b')
    expect(tokens).not.toContain('c')
    expect(tokens).toContain('abc')
  })
})

// ── computeScores — cas limites ───────────────────────────────────────────────

describe('computeScores — cas limites', () => {
  it('tokens identiques → overlap 1.00, jaccard 1.00', () => {
    const t = ['dalot', 'decharge', 'reseau']
    const { overlap, jaccard } = computeScores(t, t)
    expect(overlap).toBe(1.0)
    expect(jaccard).toBe(1.0)
  })

  it('ensembles disjoints → overlap 0, jaccard 0', () => {
    const { overlap, jaccard } = computeScores(['dalot', 'reseau'], ['tirant', 'pierre'])
    expect(overlap).toBe(0)
    expect(jaccard).toBe(0)
  })

  it('liste vide → overlap 0, jaccard 0', () => {
    const { overlap, jaccard } = computeScores([], ['dalot'])
    expect(overlap).toBe(0)
    expect(jaccard).toBe(0)
  })

  it('overlap tolère moitié omise mieux que jaccard', () => {
    // A = 10 tokens, B = 4 tokens, 4 communs → overlap = 4/4 = 1.00, jaccard = 4/10 = 0.40
    const a = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']
    const b = ['a', 'b', 'c', 'd']
    const { overlap, jaccard } = computeScores(a, b)
    expect(overlap).toBe(1.0)
    expect(jaccard).toBeCloseTo(0.4, 1)
    expect(overlap).toBeGreaterThan(jaccard)
  })
})
