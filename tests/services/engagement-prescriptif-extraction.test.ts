import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// P0-2B — extracteur prescriptif de candidats Engagements (Porte B).
// Périmètre de ce fichier : le SERVICE d'extraction seul (schéma, sanitisation,
// fallback catégorie/nature, filet anti-troncature). L'orchestrateur (garde
// d'organisation, grounding, idempotence) est couvert par
// tests/lib/extract-engagement-candidates.test.ts.

vi.mock('@/services/ai/tracking', () => ({
  withAITracking: vi.fn(async (_f, _u, fn) => {
    const r = await fn()
    return r.result
  }),
  logAIUsage: vi.fn(),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

import { runEngagementCandidateExtractionAgent } from '@/services/ai/engagement-prescriptif-extraction'

beforeEach(() => {
  vi.stubEnv('AI_PROVIDER', 'mock')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('runEngagementCandidateExtractionAgent — fixture mock', () => {
  it('retourne les candidats de la fixture avec les 5 kind et jamais de source_page', async () => {
    const r = await runEngagementCandidateExtractionAgent({
      sourceText: 'CCTP test',
      sourceLabel: 'cctp.pdf',
      userId: null,
    })
    expect(r.candidates.length).toBeGreaterThanOrEqual(7)
    const kinds = new Set(r.candidates.map((c) => c.kind))
    expect(kinds).toEqual(new Set(['objectif', 'obligation', 'livrable', 'controle', 'penalite']))
    for (const c of r.candidates) {
      expect(c).not.toHaveProperty('sourcePage')
      expect(c).not.toHaveProperty('source_page')
    }
  })

  it('chaque candidat porte un label, un extrait non vide et une confiance 0..1', async () => {
    const r = await runEngagementCandidateExtractionAgent({
      sourceText: 'CCTP test',
      sourceLabel: 'cctp.pdf',
      userId: null,
    })
    for (const c of r.candidates) {
      expect(c.label.length).toBeGreaterThan(0)
      expect(c.sourceExcerpt.length).toBeGreaterThan(0)
      expect(c.aiConfidence).toBeGreaterThanOrEqual(0)
      expect(c.aiConfidence).toBeLessThanOrEqual(1)
    }
    expect(r.metadata.provider).toBe('mock')
  })
})

describe('runEngagementCandidateExtractionAgent — sanitisation des bornes DB (mig 017)', () => {
  it('tronque un label à 100 caractères', async () => {
    vi.doMock('@/services/ai/factory', () => ({
      getAIProvider: () => ({
        name: 'mock',
        complete: async () => ({
          parsed: {
            engagements: [{
              label: 'X'.repeat(250),
              description: null,
              source_excerpt: 'Clause verbatim suffisamment longue pour passer le filtre.',
              category: 'other',
              kind: 'obligation',
              measurable: false,
              frequency_raw: null,
              confidence: 0.7,
            }],
          },
          text: '',
          tokens: 0,
          model: 'mock',
          durationMs: 0,
        }),
      }),
    }))
    vi.resetModules()
    const { runEngagementCandidateExtractionAgent: run } = await import('@/services/ai/engagement-prescriptif-extraction')
    const r = await run({ sourceText: 't', sourceLabel: 'l', userId: null })
    expect(r.candidates).toHaveLength(1)
    expect(r.candidates[0]!.label.length).toBe(100)
    vi.doUnmock('@/services/ai/factory')
    vi.resetModules()
  })

  it('tronque un extrait à 2000 caractères et rejette un extrait trop court après trim', async () => {
    vi.doMock('@/services/ai/factory', () => ({
      getAIProvider: () => ({
        name: 'mock',
        complete: async () => ({
          parsed: {
            engagements: [
              {
                label: 'Clause longue',
                description: null,
                source_excerpt: 'Y'.repeat(3000),
                category: 'other',
                kind: 'obligation',
                measurable: false,
                frequency_raw: null,
                confidence: 0.7,
              },
              {
                label: 'Trop court',
                description: null,
                source_excerpt: '  ',
                category: 'other',
                kind: 'obligation',
                measurable: false,
                frequency_raw: null,
                confidence: 0.7,
              },
            ],
          },
          text: '',
          tokens: 0,
          model: 'mock',
          durationMs: 0,
        }),
      }),
    }))
    vi.resetModules()
    const { runEngagementCandidateExtractionAgent: run } = await import('@/services/ai/engagement-prescriptif-extraction')
    const r = await run({ sourceText: 't', sourceLabel: 'l', userId: null })
    // Le 1er est conservé et tronqué à 2000 ; le 2e retombe sur son label
    // ("Trop court", 10 caractères) qui passe le seuil de 5 — comportement de
    // secours voulu, pas un rejet : seul un extrait ET un label tous deux trop
    // courts serait éliminé par le filtre final.
    expect(r.candidates).toHaveLength(2)
    expect(r.candidates[0]!.sourceExcerpt.length).toBe(2000)
    expect(r.candidates[1]!.sourceExcerpt).toBe('Trop court')
    vi.doUnmock('@/services/ai/factory')
    vi.resetModules()
  })

  it('rejette un candidat dont le label ET l\'extrait sont sous le seuil minimal', async () => {
    vi.doMock('@/services/ai/factory', () => ({
      getAIProvider: () => ({
        name: 'mock',
        complete: async () => ({
          parsed: {
            engagements: [{
              label: 'Ab',
              description: null,
              source_excerpt: '  ',
              category: 'other',
              kind: 'obligation',
              measurable: false,
              frequency_raw: null,
              confidence: 0.7,
            }],
          },
          text: '',
          tokens: 0,
          model: 'mock',
          durationMs: 0,
        }),
      }),
    }))
    vi.resetModules()
    const { runEngagementCandidateExtractionAgent: run } = await import('@/services/ai/engagement-prescriptif-extraction')
    const r = await run({ sourceText: 't', sourceLabel: 'l', userId: null })
    expect(r.candidates).toHaveLength(0)
    vi.doUnmock('@/services/ai/factory')
    vi.resetModules()
  })
})

describe('runEngagementCandidateExtractionAgent — fallback catégorie/nature (Zod .catch)', () => {
  it('retombe sur category=other et kind=obligation si le modèle sort des valeurs hors énumération', async () => {
    vi.doMock('@/services/ai/factory', () => ({
      getAIProvider: () => ({
        name: 'mock',
        complete: async () => ({
          parsed: {
            engagements: [{
              label: 'Clause avec catégorie inventée',
              description: null,
              source_excerpt: 'Extrait verbatim suffisamment long.',
              category: 'valeur_inexistante',
              kind: 'valeur_inexistante',
              measurable: false,
              frequency_raw: null,
              confidence: 0.7,
            }],
          },
          text: '',
          tokens: 0,
          model: 'mock',
          durationMs: 0,
        }),
      }),
    }))
    vi.resetModules()
    const { runEngagementCandidateExtractionAgent: run } = await import('@/services/ai/engagement-prescriptif-extraction')
    const r = await run({ sourceText: 't', sourceLabel: 'l', userId: null })
    expect(r.candidates).toHaveLength(1)
    expect(r.candidates[0]!.categorySuggestion).toBe('other')
    expect(r.candidates[0]!.kind).toBe('obligation')
    vi.doUnmock('@/services/ai/factory')
    vi.resetModules()
  })

  it('normalise une confiance exprimée 0-100 en 0-1', async () => {
    vi.doMock('@/services/ai/factory', () => ({
      getAIProvider: () => ({
        name: 'mock',
        complete: async () => ({
          parsed: {
            engagements: [{
              label: 'Clause confiance en pourcentage',
              description: null,
              source_excerpt: 'Extrait verbatim suffisamment long.',
              category: 'other',
              kind: 'obligation',
              measurable: false,
              frequency_raw: null,
              confidence: 87,
            }],
          },
          text: '',
          tokens: 0,
          model: 'mock',
          durationMs: 0,
        }),
      }),
    }))
    vi.resetModules()
    const { runEngagementCandidateExtractionAgent: run } = await import('@/services/ai/engagement-prescriptif-extraction')
    const r = await run({ sourceText: 't', sourceLabel: 'l', userId: null })
    expect(r.candidates[0]!.aiConfidence).toBeCloseTo(0.87)
    vi.doUnmock('@/services/ai/factory')
    vi.resetModules()
  })
})

describe('runEngagementCandidateExtractionAgent — filet anti-troncature', () => {
  it('récupère les objets complets d\'une sortie JSON coupée en cours de génération', async () => {
    const truncated = '{"engagements":[' +
      '{"label":"Premier engagement complet","description":null,"source_excerpt":"Extrait verbatim numero un.","category":"other","kind":"obligation","measurable":false,"frequency_raw":null,"confidence":0.8},' +
      '{"label":"Deuxieme engagement tronque","description":null,"source_excerpt":"Extrait coupe en pl'
    vi.doMock('@/services/ai/factory', () => ({
      getAIProvider: () => ({
        name: 'mock',
        complete: async () => ({
          parsed: undefined,
          text: truncated,
          tokens: 0,
          model: 'mock',
          durationMs: 0,
        }),
      }),
    }))
    vi.resetModules()
    const { runEngagementCandidateExtractionAgent: run } = await import('@/services/ai/engagement-prescriptif-extraction')
    const r = await run({ sourceText: 't', sourceLabel: 'l', userId: null })
    expect(r.candidates).toHaveLength(1)
    expect(r.candidates[0]!.label).toBe('Premier engagement complet')
    vi.doUnmock('@/services/ai/factory')
    vi.resetModules()
  })
})
