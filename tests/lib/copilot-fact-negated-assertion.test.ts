// @vitest-environment node
/**
 * P4-C — garde negated_assertion_claim sur la branche FACT (mandat Vincent,
 * 2026-08-19, suite du correctif fd25c5e6).
 *
 * fd25c5e6 empêchait déjà negated_assertion_claim de RAFFINER une réponse en
 * écriture (mergeComprehension). Il restait une incohérence : la branche FACT
 * de resolveWriteBranch() matérialisait quand même une carte de constat sur
 * la proposition rejetée. « Je ne considère pas que R4 est réglé » produisait
 * alors une carte « R4 est réglé ».
 *
 * Doctrine : un FACT portant negated_assertion_claim (ou negated_write_verb)
 * ne doit jamais produire kind:'proposal'. Réponse non mutante uniquement.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const requireSiteAccess = vi.fn()
const understandQuestion = vi.fn()

vi.mock('@/lib/auth/resource-access', () => ({
  requireSiteAccess: (...args: unknown[]) => requireSiteAccess(...args),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
  }),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ is: () => ({ in: () => ({ gte: () => ({ lte: async () => ({ data: [] }) }) }) }) }) }) }),
  }),
}))

vi.mock('@/lib/visits/copilot-comprehension', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/visits/copilot-comprehension')>()
  return { ...orig, understandQuestion: (...args: unknown[]) => understandQuestion(...args) }
})

vi.mock('@/lib/knowledge/site-overview', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/knowledge/site-overview')>()
  return { ...orig, getSiteOverview: async (siteId: string) => orig.emptySiteOverview(siteId) }
})

vi.mock('@/lib/knowledge/visit-briefing', () => ({
  buildVisitBriefing: async () => null,
}))

vi.mock('@/lib/db/visit-preparation', () => ({
  listActivePreparationItems: async () => [],
}))

vi.mock('@/lib/db/canonical-subject-resolve', () => ({
  resolveCanonicalSubjectReference: async () => ({ kind: 'none' }),
}))

vi.mock('@/lib/db/canonical-subject-life', () => ({
  getCanonicalSubjectLifeForSite: async () => null,
  getCanonicalSubjectLabelsByIds: async () => ({}),
}))

vi.mock('@/lib/db/copilot-telemetry', () => ({
  logCopilotInteraction: async () => 'iid-test',
}))

const SITE_ID = '75bd3d23-d515-46bd-8de8-254495a5bade'

function accessContext(siteId: string) {
  return { resourceId: siteId, organizationId: 'org-1', membershipRole: 'manager' as const, userId: 'u1' }
}

describe('prepareCopilotAnswer FACT — garde negated_assertion_claim (2026-08-19)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireSiteAccess.mockResolvedValue(accessContext(SITE_ID))
    understandQuestion.mockResolvedValue(null)
  })

  it('1. « Je ne considère pas que R4 est réglé » → jamais de carte de constat', async () => {
    const { prepareCopilotAnswer } = await import('@/lib/visits/copilot-free-prepare')
    const prep = await prepareCopilotAnswer({ siteId: SITE_ID, question: 'Je ne considère pas que le regard R4 est réglé.' })

    expect(prep.kind).toBe('result')
    if (prep.kind === 'result') {
      expect(prep.result.kind).not.toBe('proposal')
    }
  })

  it('2. « Je considère pas que R4 est réglé » (sans "ne") → jamais de carte de constat', async () => {
    const { prepareCopilotAnswer } = await import('@/lib/visits/copilot-free-prepare')
    const prep = await prepareCopilotAnswer({ siteId: SITE_ID, question: 'Je considère pas que le regard R4 est réglé.' })

    expect(prep.kind).toBe('result')
    if (prep.kind === 'result') {
      expect(prep.result.kind).not.toBe('proposal')
    }
  })

  it('3. compréhension LLM forcée en possible_write → toujours aucune carte', async () => {
    understandQuestion.mockResolvedValue({
      mode: 'possible_write',
      label: 'POSSIBLE_WRITE',
      intent: 'create_action',
      entities: ['R4'],
      timeScope: 'none',
      confidence: 'high',
    })
    const { prepareCopilotAnswer } = await import('@/lib/visits/copilot-free-prepare')
    const prep = await prepareCopilotAnswer({ siteId: SITE_ID, question: 'Je ne considère pas que le regard R4 est réglé.' })

    expect(prep.kind).toBe('result')
    if (prep.kind === 'result') {
      expect(prep.result.kind).not.toBe('proposal')
    }
  })

  it('4. « R4 n\'est pas réglé » (FACT positif, sans négation d\'assertion) → carte de constat inchangée', async () => {
    const { prepareCopilotAnswer } = await import('@/lib/visits/copilot-free-prepare')
    const prep = await prepareCopilotAnswer({ siteId: SITE_ID, question: "Le regard R4 n'est pas réglé." })

    expect(prep.kind).toBe('result')
    if (prep.kind === 'result') {
      expect(prep.result.kind).toBe('proposal')
    }
  })

  it('5. « Je pense que R4 n\'est pas réglé » → constat vérifié tel qu\'actuellement routé (hasOpinion exclut FACT)', async () => {
    const { prepareCopilotAnswer } = await import('@/lib/visits/copilot-free-prepare')
    const { detectIntent } = await import('@/lib/visits/copilot-intent-router')

    const q = "Je pense que le regard R4 n'est pas réglé."
    const det = detectIntent(q)
    // Constat d'audit (pré-existant, indépendant de ce lot) : OPINION_RE
    // ("je pense que") exclut explicitement la branche FACT du routeur
    // (copilot-intent-router.ts, Priorité 2bis, !hasOpinion). Cette phrase
    // n'atteint donc jamais l'intent FACT — elle retombe en lecture. La garde
    // negated_assertion_claim de ce lot ne s'applique pas ici puisque le
    // signal n'est de toute façon pas porté par une opinion positive non
    // niée. On fige ce comportement observé plutôt que de supposer un FACT.
    expect(det.intent).not.toBe('FACT')

    const prep = await prepareCopilotAnswer({ siteId: SITE_ID, question: q })
    expect(prep.kind).toBe('result')
    if (prep.kind === 'result') {
      // Jamais de carte : ni parce que bloqué par la garde (elle ne s'applique
      // pas, intent != FACT), mais parce que le routeur ne produit pas de FACT
      // pour une opinion. Documenté, pas corrigé (hors périmètre du lot).
      expect(prep.result.kind).not.toBe('proposal')
    }
  })

  it("6. régression tour terrain [4] complet → answerKind !== 'proposal'", async () => {
    const { prepareCopilotAnswer } = await import('@/lib/visits/copilot-free-prepare')
    const prep = await prepareCopilotAnswer({
      siteId: SITE_ID,
      question: 'Je ne considère pas que le regard R4 est réglé.',
    })

    expect(prep.kind).toBe('result')
    if (prep.kind === 'result') {
      expect(prep.result.kind).not.toBe('proposal')
    }
  })
})
