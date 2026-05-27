import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/knowledge', () => ({
  listKnowledgeItems: vi.fn().mockResolvedValue([]),
}))
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

import { analyzeTender } from '@/services/ai/orchestrator'

describe('analyzeTender (mock provider)', () => {
  beforeEach(() => {
    process.env.AI_PROVIDER = 'mock'
  })

  it('retourne reading + memo + score quand library vide', async () => {
    const result = await analyzeTender('Texte cahier des charges de test pour un AO de nettoyage tertiaire avec ISO 9001.', null)
    expect(result.provider).toBe('mock')
    expect(result.reading.summary).toBeTruthy()
    expect(result.reading.constraints.length).toBeGreaterThan(0)
    expect(result.reading.risks.length).toBeGreaterThan(0)
    expect(result.reading.checklist.length).toBeGreaterThan(0)
    expect(result.memo.technical_memo.length).toBeGreaterThan(100)
    expect(result.score.score).toBeGreaterThanOrEqual(0)
    expect(result.score.score).toBeLessThanOrEqual(100)
    expect(result.librarySnapshot.items_count).toBe(0)
    // Le prompt Lecteur AO a été itéré (LECTEUR_AO_V1.version = 'v3').
    expect(result.promptVersions.lecteur_ao).toBe('v3')
  })
})
