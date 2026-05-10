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

describe('chatWithAgent challenge mode (mock)', () => {
  beforeEach(() => {
    process.env.AI_PROVIDER = 'mock'
  })

  it('inclut le contexte des autres agents dans la réponse mock', async () => {
    const r = await chatWithAgent({
      agentName: 'contradicteur',
      userMessage: 'Quelles sont les contraintes principales ?',
      tenderContext: 'Tender XYZ',
      libraryContext: '',
      history: [],
      userId: null,
      challengeContext: {
        otherAgents: [
          { agent: 'lecteur_ao', content: 'Les contraintes sont ISO 9001 + CDI obligatoire' },
          { agent: 'financier', content: 'Coût estimé 100k€/an' },
        ],
      },
    })
    expect(r.content.length).toBeGreaterThan(0)
    expect(r.provider).toBe('mock')
    // Le mode mock doit signaler explicitement qu'il s'agit d'un challenge round
    expect(r.content.toLowerCase()).toMatch(/challenge|réagis|contest|nuance|autres agents/i)
  })
})
