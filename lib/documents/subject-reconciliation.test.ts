import { describe, it, expect } from 'vitest'
import { jaccardSimilarity, normalizeLabel, mapDocumentStatus } from './subject-reconciliation'

// ── normalizeLabel ────────────────────────────────────────────────────────────

describe('normalizeLabel', () => {
  it('lowercases and strips accents', () => {
    expect(normalizeLabel('Réfection des Pentes')).toBe('refection pentes')
  })

  it('removes stopwords', () => {
    expect(normalizeLabel('Couche de forme')).toBe('couche forme')
  })

  it('removes punctuation', () => {
    expect(normalizeLabel('Rapport G3 — purge complémentaire')).toBe('rapport g3 purge complementaire')
  })

  it('filters single-character tokens', () => {
    expect(normalizeLabel('R4 / R5')).toBe('r4 r5')
  })
})

// ── jaccardSimilarity ─────────────────────────────────────────────────────────

describe('jaccardSimilarity', () => {
  it('returns 1 for identical labels', () => {
    expect(jaccardSimilarity('Rapport G3 purge', 'Rapport G3 purge')).toBe(1)
  })

  it('returns 0 for completely different labels', () => {
    const score = jaccardSimilarity('Rapport G3 transmis', 'Regard R4 non conforme')
    expect(score).toBe(0)
  })

  it('recognizes same subject with status change (attendu → transmis)', () => {
    // tokens: [rapport, g3, attendu] vs [rapport, g3, transmis]
    // intersection=2, union=4, jaccard=0.5 → above threshold 0.5
    const score = jaccardSimilarity('Rapport G3 attendu', 'Rapport G3 transmis')
    expect(score).toBeCloseTo(0.5)
    expect(score).toBeGreaterThanOrEqual(0.5)
  })

  it('recognizes same work item with completion status change', () => {
    // tokens: [couche, forme, cours] vs [couche, forme, terminee]
    // intersection=2, union=4, jaccard=0.5
    const score = jaccardSimilarity('Couche de forme en cours', 'Couche de forme terminée')
    expect(score).toBeCloseTo(0.5)
    expect(score).toBeGreaterThanOrEqual(0.5)
  })

  it('recognizes same subject with label reformulation', () => {
    // tokens: [refection, pentes, cote, nord] vs [pentes, cote, nord, reprofilees]
    // intersection=3, union=5, jaccard=0.6
    const score = jaccardSimilarity('Réfection des pentes côté nord', 'Pentes côté nord reprofilées')
    expect(score).toBeCloseTo(0.6)
    expect(score).toBeGreaterThanOrEqual(0.5)
  })

  it('does not match different essais from same PV', () => {
    // tokens: [essais, sol, non, conforme] vs [essais, compactage, conforme]
    // intersection=2 (essais, conforme), union=5, jaccard=0.4 < 0.5
    const score = jaccardSimilarity('Essais sol non conforme', 'Essais compactage conforme')
    expect(score).toBeLessThan(0.5)
  })

  it('does not match different types of couche', () => {
    // "couche forme" vs "couche gnt" — intersection=1, union=3, jaccard=0.33
    const score = jaccardSimilarity('Couche de forme', 'Couche de GNT')
    expect(score).toBeLessThan(0.5)
  })

  it('strips accents before comparing', () => {
    const score = jaccardSimilarity('terrassement réalisé', 'terrassement realise')
    expect(score).toBe(1)
  })

  it('handles empty strings', () => {
    expect(jaccardSimilarity('', '')).toBe(1)
    expect(jaccardSimilarity('rapport g3', '')).toBe(0)
    expect(jaccardSimilarity('', 'rapport g3')).toBe(0)
  })
})

// ── mapDocumentStatus ─────────────────────────────────────────────────────────

describe('mapDocumentStatus', () => {
  it('maps "réalisé" → done', () => {
    expect(mapDocumentStatus('réalisé', 'knowledge_fact')).toBe('done')
    expect(mapDocumentStatus('Travaux terminés', 'knowledge_fact')).toBe('done')
    expect(mapDocumentStatus('réserve levée', 'reservation')).toBe('done')
  })

  it('maps "en cours" → in_progress', () => {
    expect(mapDocumentStatus('en cours', 'knowledge_fact')).toBe('in_progress')
    expect(mapDocumentStatus('partiellement réalisé', 'knowledge_fact')).toBe('in_progress')
  })

  it('maps "prévu" → planned', () => {
    expect(mapDocumentStatus('prévu', 'knowledge_fact')).toBe('planned')
    expect(mapDocumentStatus('non démarré', 'knowledge_fact')).toBe('planned')
  })

  it('maps "non conforme" → non_compliant', () => {
    expect(mapDocumentStatus('non conforme', 'knowledge_fact')).toBe('non_compliant')
    expect(mapDocumentStatus('refusé', 'knowledge_fact')).toBe('non_compliant')
  })

  it('maps "en attente de validation" → awaiting_validation', () => {
    expect(mapDocumentStatus('en attente de validation', 'knowledge_fact')).toBe('awaiting_validation')
    expect(mapDocumentStatus('attendu', 'knowledge_fact')).toBe('awaiting_validation')
    expect(mapDocumentStatus('VISA en cours', 'knowledge_fact')).toBe('awaiting_validation')
  })

  it('maps "annulé" → cancelled', () => {
    expect(mapDocumentStatus('annulé', 'knowledge_fact')).toBe('cancelled')
  })

  it('maps unknown values → informational', () => {
    expect(mapDocumentStatus('autre statut', 'knowledge_fact')).toBe('informational')
  })

  it('returns null for person/company families', () => {
    expect(mapDocumentStatus('présent', 'person')).toBeNull()
    expect(mapDocumentStatus('présente', 'company')).toBeNull()
  })

  it('returns null for null/empty input', () => {
    expect(mapDocumentStatus(null, 'knowledge_fact')).toBeNull()
    expect(mapDocumentStatus('', 'knowledge_fact')).toBeNull()
    expect(mapDocumentStatus(undefined, 'knowledge_fact')).toBeNull()
  })
})
