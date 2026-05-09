import { describe, it, expect, vi, beforeEach } from 'vitest'

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

import { chatWithAgent } from '@/services/ai/chat'

describe('chatWithAgent (mock provider)', () => {
  beforeEach(() => {
    process.env.AI_PROVIDER = 'mock'
  })

  it('retourne une réponse pour chaque agent en mode mock', async () => {
    for (const agent of ['general', 'lecteur_ao', 'memoire_technique', 'contradicteur', 'financier', 'terrain', 'conformite'] as const) {
      const r = await chatWithAgent({
        agentName: agent,
        userMessage: 'Test question',
        tenderContext: 'Tender XYZ',
        libraryContext: '',
        history: [],
        userId: null,
      })
      expect(r.content.length).toBeGreaterThan(0)
      expect(r.provider).toBe('mock')
      expect(r.promptVersion).toBe('v1')
    }
  })
})
