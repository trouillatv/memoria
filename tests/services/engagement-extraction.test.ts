import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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

import { runEngagementExtractionAgent } from '@/services/ai/engagement-extraction'

beforeEach(() => {
  vi.stubEnv('AI_PROVIDER', 'mock')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('runEngagementExtractionAgent', () => {
  it('returns extracted engagements from mock provider', async () => {
    const r = await runEngagementExtractionAgent({
      aoText: 'AO test content',
      memoireTechniqueText: 'Mémoire technique content',
      userId: null,
    })
    expect(r.engagements.length).toBeGreaterThanOrEqual(3)
    expect(r.engagements[0]).toMatchObject({
      source_type: expect.stringMatching(/^(ao_clause|memoire_engagement)$/),
      short_label: expect.any(String),
      ai_confidence: expect.any(Number),
    })
    expect(r.metadata.provider).toBe('mock')
  })

  it('engagements have all required fields', async () => {
    const r = await runEngagementExtractionAgent({
      aoText: 'AO',
      memoireTechniqueText: null,
      userId: null,
    })
    for (const e of r.engagements) {
      expect(e.source_excerpt.length).toBeGreaterThan(0)
      expect(e.short_label.length).toBeGreaterThan(0)
      expect(e.ai_confidence).toBeGreaterThanOrEqual(0)
      expect(e.ai_confidence).toBeLessThanOrEqual(1)
      expect([
        'frequency',
        'quality',
        'compliance',
        'delivery',
        'sla',
        'reporting',
        'other',
      ]).toContain(e.category)
    }
  })
})
