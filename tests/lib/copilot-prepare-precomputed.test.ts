// @vitest-environment node
/**
 * P2-C — `prepareCopilotAnswer` avec précalcul injecté (tour vocal).
 *
 * Le mandat exige : « résultat métier et références strictement identiques
 * avec/sans overlap », « aucun second chargement des mêmes read-models », et
 * « aucune donnée préchargée ne traverse le pipeline sur refus d'accès ».
 * Ici on appelle la VRAIE fonction (moteurs déterministes réels), seuls les
 * accès DB/LLM sont substitués — mêmes substituts dans les deux modes, donc
 * toute divergence viendrait du code, pas des données.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const counters = { overview: 0, briefing: 0, prepItems: 0 }
const requireSiteAccess = vi.fn()

vi.mock('@/lib/auth/resource-access', () => ({
  requireSiteAccess: (...args: unknown[]) => requireSiteAccess(...args),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
  }),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => {
    throw new Error('le chemin lecture ne doit pas toucher le client admin')
  },
}))

vi.mock('@/lib/knowledge/site-overview', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/knowledge/site-overview')>()
  return {
    ...orig,
    getSiteOverview: async (siteId: string) => {
      counters.overview++
      const o = orig.emptySiteOverview(siteId)
      return { ...o, identity: { ...o.identity, name: 'PETRO TEST' } }
    },
  }
})

vi.mock('@/lib/knowledge/visit-briefing', () => ({
  buildVisitBriefing: async () => { counters.briefing++; return null },
}))

vi.mock('@/lib/db/visit-preparation', () => ({
  listActivePreparationItems: async () => {
    counters.prepItems++
    return [{ label: 'Vérifier le SSI', stableKey: 'ssi-1' }]
  },
}))

vi.mock('@/lib/visits/copilot-comprehension', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/visits/copilot-comprehension')>()
  return { ...orig, understandQuestion: async () => null }
})

vi.mock('@/lib/db/canonical-subject-resolve', () => ({
  resolveCanonicalSubjectReference: async () => ({ kind: 'not_found' }),
}))

vi.mock('@/lib/db/canonical-subject-life', () => ({
  getCanonicalSubjectLifeForSite: async () => null,
}))

vi.mock('@/lib/db/site-actor-responsibilities', () => ({
  getSiteActorContext: async () => [],
}))

vi.mock('@/lib/db/copilot-telemetry', () => ({
  logCopilotInteraction: async () => 'iid-test',
}))

const SITE_ID = '75bd3d23-d515-46bd-8de8-254495a5bade'
const QUESTION = 'Où en est le chantier ?'

function accessContext(siteId: string) {
  return { resourceId: siteId, organizationId: 'org-1', membershipRole: 'manager' as const, userId: 'u1' }
}

/** La partie COMPARABLE d'un résultat `ready` (tout sauf la closure `finish`). */
function comparable(prep: { kind: string } & Record<string, unknown>) {
  if (prep.kind !== 'ready') return prep
  const { finish, ...rest } = prep as Record<string, unknown>
  void finish
  return rest
}

describe('prepareCopilotAnswer — identique avec et sans précalcul', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    counters.overview = 0
    counters.briefing = 0
    counters.prepItems = 0
    requireSiteAccess.mockResolvedValue(accessContext(SITE_ID))
  })

  it('6. même résultat métier, mêmes items, même contexte — avec et sans overlap', async () => {
    const { prepareCopilotAnswer, startCopilotSitePrefetch } = await import('@/lib/visits/copilot-free-prepare')
    const input = { siteId: SITE_ID, question: QUESTION }

    const sans = await prepareCopilotAnswer(input)
    const avec = await prepareCopilotAnswer(input, {
      access: accessContext(SITE_ID),
      prefetch: startCopilotSitePrefetch(SITE_ID, 'u1'),
    })

    expect(sans.kind).toBe('ready')
    expect(avec.kind).toBe('ready')
    expect(comparable(avec as never)).toEqual(comparable(sans as never))
  })

  it('2. précalcul injecté → AUCUN second chargement des mêmes read-models', async () => {
    const { prepareCopilotAnswer, startCopilotSitePrefetch } = await import('@/lib/visits/copilot-free-prepare')

    const prefetch = startCopilotSitePrefetch(SITE_ID, 'u1')
    expect(counters.overview).toBe(1) // le préchargement lui-même

    const prep = await prepareCopilotAnswer(
      { siteId: SITE_ID, question: QUESTION },
      { access: accessContext(SITE_ID), prefetch },
    )

    expect(prep.kind).toBe('ready')
    // Toujours 1 : la préparation a consommé les promesses en vol, pas relancé.
    expect(counters.overview).toBe(1)
    expect(counters.briefing).toBe(1)
    expect(counters.prepItems).toBe(1)
    // Et l'accès n'a pas été revérifié : la décision venait de la primitive
    // canonique exécutée par la route, transmise telle quelle.
    expect(requireSiteAccess).not.toHaveBeenCalled()
  })

  it('3. accès refusé (sans précalcul) → refus AVANT toute lecture', async () => {
    requireSiteAccess.mockRejectedValue(new Error('NEXT_NOT_FOUND'))
    const { prepareCopilotAnswer } = await import('@/lib/visits/copilot-free-prepare')

    const prep = await prepareCopilotAnswer({ siteId: SITE_ID, question: QUESTION })

    expect(prep).toEqual({
      kind: 'result',
      result: { kind: 'answer', text: 'Accès non autorisé.', references: [], source: 'fallback', interactionId: null },
    })
    expect(counters.overview).toBe(0)
    expect(counters.briefing).toBe(0)
  })

  it('un précalcul pour un AUTRE chantier est ignoré : garde canonique rejouée, promesses jetées', async () => {
    const { prepareCopilotAnswer, startCopilotSitePrefetch } = await import('@/lib/visits/copilot-free-prepare')

    const foreign = startCopilotSitePrefetch('00000000-0000-4000-8000-000000000002', 'u1')
    expect(counters.overview).toBe(1)

    const prep = await prepareCopilotAnswer(
      { siteId: SITE_ID, question: QUESTION },
      { access: accessContext('00000000-0000-4000-8000-000000000002'), prefetch: foreign },
    )

    expect(prep.kind).toBe('ready')
    // La garde canonique a repris la main…
    expect(requireSiteAccess).toHaveBeenCalledWith(SITE_ID)
    // …et le contexte a été rechargé pour LE BON chantier (le préchargement
    // étranger est simplement jeté, jamais consommé).
    expect(counters.overview).toBe(2)
    if (prep.kind === 'ready') expect(prep.siteName).toBe('PETRO TEST')
  })
})
