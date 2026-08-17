// @vitest-environment node
/**
 * P4-B.1 — correction/clarification locale du tour (mandat Vincent, 2026-08-17).
 *
 * Scénario prouvé : « Le cadenas n'est toujours pas posé. » → ambiguïté
 * (deux sujets "cadenas" réels sur PETRO) → l'utilisateur sélectionne un
 * candidat → le tour repris avec `selectedCandidateId` doit court-circuiter
 * ENTIÈREMENT `resolveCanonicalSubjectReference` (sinon la même ambiguïté
 * ressort) et reprendre directement le brouillon OBSERVATION.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const requireSiteAccess = vi.fn()
const resolveCanonicalSubjectReference = vi.fn()
const getCanonicalSubjectLabelsByIds = vi.fn()

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
  return { ...orig, understandQuestion: async () => null }
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
  resolveCanonicalSubjectReference: (...args: unknown[]) => resolveCanonicalSubjectReference(...args),
}))

vi.mock('@/lib/db/canonical-subject-life', () => ({
  getCanonicalSubjectLifeForSite: async () => null,
  getCanonicalSubjectLabelsByIds: (...args: unknown[]) => getCanonicalSubjectLabelsByIds(...args),
}))

vi.mock('@/lib/db/copilot-telemetry', () => ({
  logCopilotInteraction: async () => 'iid-test',
}))

const SITE_ID = '75bd3d23-d515-46bd-8de8-254495a5bade'
const ACCES_ID = '6801ce5c-17e9-4939-93c5-175754add1f5'
const QUESTION = "Le cadenas n'est toujours pas posé."
// Guillemets = extraction déterministe sans LLM (extractSubjectLabels), pour
// exercer le chemin resolveCanonicalSubjectReference sans dépendre du hint LLM.
const QUESTION_WITH_QUOTED_SUBJECT = 'Le "cadenas" n\'est toujours pas posé.'

function accessContext(siteId: string) {
  return { resourceId: siteId, organizationId: 'org-1', membershipRole: 'manager' as const, userId: 'u1' }
}

describe('prepareCopilotAnswer OBSERVATION — selectedCandidateId (P4-B.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireSiteAccess.mockResolvedValue(accessContext(SITE_ID))
  })

  it('sans selectedCandidateId : ambiguïté → clarification (comportement P4-A.1 inchangé)', async () => {
    resolveCanonicalSubjectReference.mockResolvedValue({
      kind: 'ambiguous',
      candidates: [
        { id: 'subj-securisation', label: 'Sécurisation du site : finalisation des cadenas' },
        { id: ACCES_ID, label: 'Accès sécurisé au chantier (portail et cadenas à code)' },
      ],
    })
    const { prepareCopilotAnswer } = await import('@/lib/visits/copilot-free-prepare')

    const prep = await prepareCopilotAnswer({ siteId: SITE_ID, question: QUESTION_WITH_QUOTED_SUBJECT })

    expect(prep.kind).toBe('result')
    if (prep.kind === 'result') {
      expect(prep.result.kind).toBe('clarification')
    }
    expect(getCanonicalSubjectLabelsByIds).not.toHaveBeenCalled()
  })

  it('avec selectedCandidateId : court-circuite la résolution et reprend le brouillon OBSERVATION', async () => {
    getCanonicalSubjectLabelsByIds.mockResolvedValue({
      [ACCES_ID]: 'Accès sécurisé au chantier (portail et cadenas à code)',
    })
    const { prepareCopilotAnswer } = await import('@/lib/visits/copilot-free-prepare')

    const prep = await prepareCopilotAnswer({
      siteId: SITE_ID,
      question: QUESTION,
      selectedCandidateId: ACCES_ID,
    })

    // La résolution lexicale n'est JAMAIS rappelée : sinon la même ambiguïté ressortirait.
    expect(resolveCanonicalSubjectReference).not.toHaveBeenCalled()
    expect(getCanonicalSubjectLabelsByIds).toHaveBeenCalledWith([ACCES_ID])

    expect(prep.kind).toBe('result')
    if (prep.kind === 'result') {
      expect(prep.result.kind).toBe('proposal')
      if (prep.result.kind === 'proposal') {
        const proposal = prep.result.proposal as unknown as {
          canonicalSubjectId: string | null
          canonicalSubjectLabel: string | null
        }
        expect(proposal.canonicalSubjectId).toBe(ACCES_ID)
        expect(proposal.canonicalSubjectLabel).toBe('Accès sécurisé au chantier (portail et cadenas à code)')
      }
    }
  })
})
