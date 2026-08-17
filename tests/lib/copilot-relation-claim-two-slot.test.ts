// @vitest-environment node
/**
 * P4-D1 — résolution à deux emplacements (source/cible) de RELATION_CLAIM
 * (mandat Vincent, 2026-08-17 : « Le SSI dépend de la mise sous tension »).
 *
 * Le protocole Copilote existant n'a qu'un seul emplacement de résolution par
 * tour (selectedCandidateId singulier + resolvedSubjectIds accumulé côté
 * client). Réutilisé SANS extension : la source est toujours résolue avant la
 * cible ; un candidat déjà choisi lors d'un tour précédent (présent dans
 * resolvedSubjectIds/selectedCandidateId) tranche silencieusement une
 * ambiguïté sur l'AUTRE emplacement sans reposer la question.
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

const SITE_ID    = '75bd3d23-d515-46bd-8de8-254495a5bade'
const SSI_ID     = '11111111-1111-4111-8111-111111111111'
const SSI_ALT_ID = '44444444-4444-4444-8444-444444444444'
const MST_ID     = '22222222-2222-4222-8222-222222222222'
const MST_OLD_ID = '33333333-3333-4333-8333-333333333333'
const QUESTION   = 'Le SSI dépend de la mise sous tension.'

function accessContext(siteId: string) {
  return { resourceId: siteId, organizationId: 'org-1', membershipRole: 'manager' as const, userId: 'u1' }
}

describe('prepareCopilotAnswer RELATION_CLAIM — résolution deux emplacements (P4-D1)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireSiteAccess.mockResolvedValue(accessContext(SITE_ID))
  })

  it('source et cible résolues sans ambiguïté → proposal relation_claim avec preuve verbatim', async () => {
    resolveCanonicalSubjectReference
      .mockResolvedValueOnce({ kind: 'resolved', candidate: { id: SSI_ID, label: 'SSI' } })
      .mockResolvedValueOnce({ kind: 'resolved', candidate: { id: MST_ID, label: 'Mise sous tension' } })
    const { prepareCopilotAnswer } = await import('@/lib/visits/copilot-free-prepare')

    const prep = await prepareCopilotAnswer({ siteId: SITE_ID, question: QUESTION })

    expect(prep.kind).toBe('result')
    if (prep.kind !== 'result') return
    expect(prep.result.kind).toBe('proposal')
    if (prep.result.kind !== 'proposal') return
    const proposal = prep.result.proposal
    expect(proposal.kind).toBe('relation_claim')
    expect(proposal.relationType).toBe('requires')
    expect(proposal.relationSourceSubjectId).toBe(SSI_ID)
    expect(proposal.relationSourceSubjectLabel).toBe('SSI')
    expect(proposal.relationTargetSubjectId).toBe(MST_ID)
    expect(proposal.relationTargetSubjectLabel).toBe('Mise sous tension')
    // Preuve textuelle = phrase littérale de l'utilisateur, jamais reformulée.
    expect(proposal.body).toBe(QUESTION)
  })

  it('source ambiguë → clarification portant UNIQUEMENT sur la source (cible jamais résolue)', async () => {
    resolveCanonicalSubjectReference.mockResolvedValueOnce({
      kind: 'ambiguous',
      candidates: [{ id: SSI_ID, label: 'SSI bâtiment A' }, { id: SSI_ALT_ID, label: 'SSI bâtiment B' }],
    })
    const { prepareCopilotAnswer } = await import('@/lib/visits/copilot-free-prepare')

    const prep = await prepareCopilotAnswer({ siteId: SITE_ID, question: QUESTION })

    expect(resolveCanonicalSubjectReference).toHaveBeenCalledTimes(1)
    expect(prep.kind).toBe('result')
    if (prep.kind !== 'result') return
    expect(prep.result.kind).toBe('clarification')
    if (prep.result.kind !== 'clarification') return
    expect(prep.result.candidates.map((c) => c.id)).toEqual([SSI_ID, SSI_ALT_ID])
  })

  it('cible ambiguë (source résolue) → clarification portant UNIQUEMENT sur la cible', async () => {
    resolveCanonicalSubjectReference
      .mockResolvedValueOnce({ kind: 'resolved', candidate: { id: SSI_ID, label: 'SSI' } })
      .mockResolvedValueOnce({
        kind: 'ambiguous',
        candidates: [{ id: MST_ID, label: 'Mise sous tension' }, { id: MST_OLD_ID, label: 'Mise sous tension (ancien tableau)' }],
      })
    const { prepareCopilotAnswer } = await import('@/lib/visits/copilot-free-prepare')

    const prep = await prepareCopilotAnswer({ siteId: SITE_ID, question: QUESTION })

    expect(resolveCanonicalSubjectReference).toHaveBeenCalledTimes(2)
    expect(prep.kind).toBe('result')
    if (prep.kind !== 'result') return
    expect(prep.result.kind).toBe('clarification')
    if (prep.result.kind !== 'clarification') return
    expect(prep.result.candidates.map((c) => c.id)).toEqual([MST_ID, MST_OLD_ID])
  })

  it('candidat de cible déjà choisi lors d\'un tour précédent (resolvedSubjectIds) → tranche sans reposer la question', async () => {
    resolveCanonicalSubjectReference
      .mockResolvedValueOnce({ kind: 'resolved', candidate: { id: SSI_ID, label: 'SSI' } })
      .mockResolvedValueOnce({
        kind: 'ambiguous',
        candidates: [{ id: MST_ID, label: 'Mise sous tension' }, { id: MST_OLD_ID, label: 'Mise sous tension (ancien tableau)' }],
      })
    const { prepareCopilotAnswer } = await import('@/lib/visits/copilot-free-prepare')

    // MST_ID a déjà été résolu lors d'un tour précédent de la conversation.
    const prep = await prepareCopilotAnswer({ siteId: SITE_ID, question: QUESTION, resolvedSubjectIds: [MST_ID] })

    expect(prep.kind).toBe('result')
    if (prep.kind !== 'result') return
    expect(prep.result.kind).toBe('proposal')
    if (prep.result.kind !== 'proposal') return
    expect(prep.result.proposal.relationTargetSubjectId).toBe(MST_ID)
    expect(prep.result.proposal.relationTargetSubjectLabel).toBe('Mise sous tension')
  })

  it('source introuvable → réponse d\'échec, cible jamais résolue', async () => {
    resolveCanonicalSubjectReference.mockResolvedValueOnce({ kind: 'not_found' })
    const { prepareCopilotAnswer } = await import('@/lib/visits/copilot-free-prepare')

    const prep = await prepareCopilotAnswer({ siteId: SITE_ID, question: QUESTION })

    expect(resolveCanonicalSubjectReference).toHaveBeenCalledTimes(1)
    expect(prep.kind).toBe('result')
    if (prep.kind !== 'result') return
    expect(prep.result.kind).toBe('answer')
  })

  it('source et cible résolues sur le même sujet → réponse de clarification, aucune proposition', async () => {
    resolveCanonicalSubjectReference
      .mockResolvedValueOnce({ kind: 'resolved', candidate: { id: SSI_ID, label: 'SSI' } })
      .mockResolvedValueOnce({ kind: 'resolved', candidate: { id: SSI_ID, label: 'SSI' } })
    const { prepareCopilotAnswer } = await import('@/lib/visits/copilot-free-prepare')

    const prep = await prepareCopilotAnswer({ siteId: SITE_ID, question: QUESTION })

    expect(prep.kind).toBe('result')
    if (prep.kind !== 'result') return
    expect(prep.result.kind).toBe('answer')
  })
})
