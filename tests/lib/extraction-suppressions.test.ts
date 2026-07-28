import { describe, it, expect } from 'vitest'
import { extractTokens, matchSuppression, DEFAULT_SUPPRESSION_THRESHOLD } from '@/lib/db/extraction-suppressions'

// ── Tests verrouillés (Vincent, 2026-07-28) ──────────────────────────────────
// Formule : score = overlap / suppressionTokens.length
// Déclenchement : overlap ≥ 2 ET score ≥ 0.6

describe('extractTokens', () => {
  it('normalise casse, accents et ponctuation', () => {
    const tokens = extractTokens('Vérification des Lignes & Consignations!')
    expect(tokens).toContain('verification')
    expect(tokens).toContain('lignes')
    expect(tokens).toContain('consignations')
  })

  it('exclut les mots courts (< 4 lettres)', () => {
    const tokens = extractTokens('les des une sur')
    expect(tokens).toHaveLength(0)
  })

  it('neutralise les doublons — un mot ne compte qu\'une fois', () => {
    const tokens = extractTokens('vérification vérification des lignes lignes')
    expect(tokens.filter((t) => t === 'verification')).toHaveLength(1)
    expect(tokens.filter((t) => t === 'lignes')).toHaveLength(1)
  })
})

describe('matchSuppression', () => {
  it('zéro token dans la suppression → refus (jamais matched)', () => {
    const m = matchSuppression('Vérification des lignes', [])
    expect(m.matched).toBe(false)
    expect(m.suppressionTokenCount).toBe(0)
  })

  it('un token dans la suppression → refus (pattern trop court)', () => {
    const m = matchSuppression('Vérification des lignes et consignations', ['verification'])
    expect(m.matched).toBe(false)
    expect(m.suppressionTokenCount).toBe(1)
  })

  it('un seul mot commun → jamais masqué (overlap < 2)', () => {
    // suppression = ["verification", "lignes"], proposal partage "lignes" seul
    const m = matchSuppression('Contrôle des lignes électriques', ['verification', 'lignes'])
    expect(m.overlap).toBe(1)
    expect(m.matched).toBe(false)
  })

  it('un mot sur deux → non masqué (score 0.5 < 0.6)', () => {
    // "verification" est dans la suppression mais pas dans la proposition (qui a "consignations" seul)
    const sup = ['verification', 'consignations']
    const m = matchSuppression('Contrôle des consignations électriques', sup)
    expect(m.overlap).toBe(1)
    expect(m.score).toBeCloseTo(0.5)
    expect(m.matched).toBe(false)
  })

  it('deux mots sur trois → masqué (score 0.67 ≥ 0.6, overlap ≥ 2)', () => {
    const sup = ['verification', 'lignes', 'consignations']
    const m = matchSuppression('Contrôle des lignes et consignations', sup)
    expect(m.overlap).toBe(2)
    expect(m.score).toBeCloseTo(2 / 3)
    expect(m.matched).toBe(true)
  })

  it('deux mots sur deux → masqué (score 1.0)', () => {
    const sup = ['verification', 'lignes']
    const m = matchSuppression('Vérification des lignes électriques', sup)
    expect(m.overlap).toBe(2)
    expect(m.score).toBeCloseTo(1)
    expect(m.matched).toBe(true)
  })

  it('tous les tokens de la suppression dans une proposition plus longue → score 1', () => {
    const sup = ['verification', 'lignes', 'consignations']
    const m = matchSuppression('Réaliser la vérification des lignes et des consignations électriques avant lundi', sup)
    expect(m.overlap).toBe(3)
    expect(m.score).toBeCloseTo(1)
    expect(m.matched).toBe(true)
  })

  it('doublons dans le titre de la proposition → neutralisés, overlap exact', () => {
    // « vérification vérification » ne doit pas compter deux fois
    const sup = ['verification', 'lignes']
    const m = matchSuppression('vérification vérification des lignes lignes', sup)
    expect(m.overlap).toBe(2)
    expect(m.matched).toBe(true)
  })

  it('matchedTokens liste exactement les tokens communs', () => {
    const sup = ['verification', 'lignes', 'consignations']
    const m = matchSuppression('Contrôle des lignes et des consignations', sup)
    expect(m.matchedTokens.sort()).toEqual(['consignations', 'lignes'])
  })

  it('seuil 0.5 : 2 tokens sur 4 → masqué (score 0.5 ≥ threshold, overlap ≥ 2)', () => {
    // 4 tokens dans la suppression, 2 dans la proposition → score 0.5
    // Avec threshold 0.5 et overlap ≥ 2 : masqué. Avec 0.6 (défaut) : non masqué.
    const sup = ['verification', 'lignes', 'consignations', 'electriques']
    const m = matchSuppression('Vérification des lignes de plomberie', sup, 0.5)
    expect(m.overlap).toBe(2)
    expect(m.score).toBeCloseTo(0.5)
    expect(m.matched).toBe(true)
  })

  it('DEFAULT_SUPPRESSION_THRESHOLD est 0.6', () => {
    expect(DEFAULT_SUPPRESSION_THRESHOLD).toBe(0.6)
  })
})
