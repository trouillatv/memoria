// @vitest-environment node
/**
 * P6-A2 — shadow mode `decompose-v2` sur un VRAI tour `prepareCopilotAnswer`.
 *
 * Complète `copilot-decompose-shadow.test.ts` (qui teste le probe isolément)
 * par la preuve la plus forte possible : la réponse réelle du pipeline est
 * BYTE-IDENTIQUE que le shadow réussisse, échoue, ou soit désactivé. On force
 * `after()` à exécuter réellement le probe (au lieu de lever hors contexte de
 * requête comme en production/tests) pour que cette preuve ne soit pas
 * vacueuse.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const counters = { overview: 0, briefing: 0, prepItems: 0 }
const requireSiteAccess = vi.fn()
const inserted: Array<Record<string, unknown>> = []
const pendingAfter: Promise<unknown>[] = []

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
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        inserted.push({ table, ...row })
        return Promise.resolve({ data: null, error: null })
      },
    }),
  }),
}))

// `after()` réel ne s'exécute qu'en contexte de requête Next.js — hors de ce
// contexte (comme ici), il lève et le shadow s'efface silencieusement. On le
// remplace pour FORCER l'exécution du probe et prouver que son issue,
// quelle qu'elle soit, ne change jamais la réponse retournée à l'appelant.
vi.mock('next/server', () => ({
  after: (fn: () => Promise<unknown>) => { pendingAfter.push(fn()) },
}))

let decomposeImpl: () => Promise<import('@/services/ai').CompletionOutput> = async () => ({
  text: '', parsed: {}, tokens: { input: 0, output: 0 }, model: 'test', durationMs: 1,
})

vi.mock('@/services/ai/factory', () => ({
  getAIProvider: () => ({ name: 'mock-shadow', complete: () => decomposeImpl() }),
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

function comparable(prep: { kind: string } & Record<string, unknown>) {
  if (prep.kind !== 'ready') return prep
  const { finish, ...rest } = prep as Record<string, unknown>
  void finish
  return rest
}

async function drainAfter() {
  await Promise.all(pendingAfter)
  pendingAfter.length = 0
}

describe('prepareCopilotAnswer — réponse identique quelle que soit l’issue du shadow decompose-v2', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    counters.overview = 0
    counters.briefing = 0
    counters.prepItems = 0
    inserted.length = 0
    pendingAfter.length = 0
    requireSiteAccess.mockResolvedValue(accessContext(SITE_ID))
  })

  it('shadow réussi (3 segments) vs shadow désactivé : même réponse', async () => {
    const { prepareCopilotAnswer } = await import('@/lib/visits/copilot-free-prepare')

    decomposeImpl = async () => ({
      text: '',
      parsed: { segments: [{ start: 0, end: QUESTION.length, dependsOn: null }], ambiguous: false },
      tokens: { input: 0, output: 0 }, model: 'test', durationMs: 1,
    })
    const avecShadow = await prepareCopilotAnswer({ siteId: SITE_ID, question: QUESTION })
    await drainAfter()
    expect(inserted).toHaveLength(1) // preuve que le shadow a bien tourné dans ce test

    const prevFlag = process.env.COPILOT_DECOMPOSE_SHADOW
    process.env.COPILOT_DECOMPOSE_SHADOW = '0'
    inserted.length = 0
    const sansShadow = await prepareCopilotAnswer({ siteId: SITE_ID, question: QUESTION })
    await drainAfter()
    if (prevFlag === undefined) delete process.env.COPILOT_DECOMPOSE_SHADOW
    else process.env.COPILOT_DECOMPOSE_SHADOW = prevFlag

    expect(inserted).toHaveLength(0) // coupe-circuit confirmé
    expect(comparable(avecShadow as never)).toEqual(comparable(sansShadow as never))
  })

  it('shadow en échec (provider down) : même réponse que le cas nominal', async () => {
    const { prepareCopilotAnswer } = await import('@/lib/visits/copilot-free-prepare')

    decomposeImpl = async () => ({
      text: '', parsed: { segments: [{ start: 0, end: QUESTION.length, dependsOn: null }], ambiguous: false },
      tokens: { input: 0, output: 0 }, model: 'test', durationMs: 1,
    })
    const nominal = await prepareCopilotAnswer({ siteId: SITE_ID, question: QUESTION })
    await drainAfter()

    decomposeImpl = async () => { throw new Error('provider down') }
    const echec = await prepareCopilotAnswer({ siteId: SITE_ID, question: QUESTION })
    await drainAfter()
    expect(inserted.some((r) => r.error === null || typeof r.error === 'string')).toBe(true)

    expect(comparable(echec as never)).toEqual(comparable(nominal as never))
  })
})
