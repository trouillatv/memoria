// @vitest-environment node
/**
 * Q5 — sécurisation de la confirmation des transcription_alias (Vincent,
 * 2026-08-18). Ce fichier exerce `confirmActorAlias` DIRECTEMENT — jamais via
 * `createCopilotActorAlias`/la carte UI — précisément pour prouver que le
 * writer est la vraie barrière : un appelant qui contourne la UI (script,
 * autre caller) reste soumis aux mêmes gardes.
 *
 * Ne change ni normalizeTranscript, ni les seuils Levenshtein, ni Q4.5.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Handler = () => { data: unknown }

let tableHandlers: Record<string, Handler[]> = {}

function buildAdmin() {
  const counts: Record<string, number> = {}
  function makeChain(table: string) {
    const resolve = () => {
      const idx = counts[table] ?? 0
      counts[table] = idx + 1
      const handler = tableHandlers[table]?.[idx]
      if (!handler) throw new Error(`Pas de handler pour la table "${table}" (appel #${idx})`)
      return Promise.resolve(handler())
    }
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      insert: () => chain,
      update: () => chain,
      maybeSingle: () => resolve(),
      single: () => resolve(),
      then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
        resolve().then(onFulfilled, onRejected),
    }
    return chain
  }
  return { from: (table: string) => makeChain(table) }
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => buildAdmin(),
}))

vi.mock('@/lib/db/copilot-telemetry', () => ({
  updateCopilotProposalStatus: vi.fn(async () => {}),
}))

const ORG_ID = 'org-1'
const TARGET_COMPANY_ID = 'company-becib'
const TARGET_CONTACT_ID = 'contact-jerome'

function baseParams(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORG_ID,
    userId: 'user-1',
    targetKind: 'company' as const,
    targetId: TARGET_COMPANY_ID,
    copilotProposalId: 'proposal-1',
    interactionId: null,
    ...overrides,
  }
}

const noExisting: Handler = () => ({ data: null })
const insertOk: Handler = () => ({ data: { id: 'new-alias-id' } })
const companyTarget = (label: string): Handler => () => ({ data: { id: TARGET_COMPANY_ID, name: label } })
const contactTarget = (label: string): Handler => () => ({ data: { id: TARGET_CONTACT_ID, full_name: label } })
const rows = (data: unknown[]): Handler => () => ({ data })

beforeEach(() => {
  vi.clearAllMocks()
  tableHandlers = {}
})

describe('confirmActorAlias — Q5, transcription_alias reinforced (Bessie/imbécile → BECIB)', () => {
  it('« Bessie » → BECIB sans geste explicite : bloqué', async () => {
    tableHandlers = {
      actor_alias: [noExisting],
      companies: [companyTarget('BECIB'), rows([])],
      company_contacts: [rows([])],
    }
    const { confirmActorAlias } = await import('@/lib/db/actor-alias-write')
    const res = await confirmActorAlias({
      ...baseParams(),
      alias: 'Bessie',
      aliasNature: 'transcription_alias',
    })
    expect(res.ok).toBe(false)
  })

  it('« Bessie » → BECIB avec reinforcedConfirmation=true : autorisable', async () => {
    tableHandlers = {
      actor_alias: [noExisting, insertOk],
      companies: [companyTarget('BECIB'), rows([])],
      company_contacts: [rows([])],
    }
    const { confirmActorAlias } = await import('@/lib/db/actor-alias-write')
    const res = await confirmActorAlias({
      ...baseParams(),
      alias: 'Bessie',
      aliasNature: 'transcription_alias',
      reinforcedConfirmation: true,
    })
    expect(res.ok).toBe(true)
  })

  it('« imbécile » → BECIB sans geste explicite : bloqué (aucune distinction lexicale tentée)', async () => {
    tableHandlers = {
      actor_alias: [noExisting],
      companies: [companyTarget('BECIB'), rows([])],
      company_contacts: [rows([])],
    }
    const { confirmActorAlias } = await import('@/lib/db/actor-alias-write')
    const res = await confirmActorAlias({
      ...baseParams(),
      alias: 'imbécile',
      aliasNature: 'transcription_alias',
    })
    expect(res.ok).toBe(false)
  })

  it('« imbécile » → BECIB avec reinforcedConfirmation=true : autorisable seulement après le geste explicite', async () => {
    tableHandlers = {
      actor_alias: [noExisting, insertOk],
      companies: [companyTarget('BECIB'), rows([])],
      company_contacts: [rows([])],
    }
    const { confirmActorAlias } = await import('@/lib/db/actor-alias-write')
    const res = await confirmActorAlias({
      ...baseParams(),
      alias: 'imbécile',
      aliasNature: 'transcription_alias',
      reinforcedConfirmation: true,
    })
    expect(res.ok).toBe(true)
  })
})

describe('confirmActorAlias — Q5, business_alias hors périmètre', () => {
  it('« clim » → Clim Expert en business_alias : comportement inchangé, aucune garde Q5', async () => {
    tableHandlers = {
      actor_alias: [noExisting, insertOk],
      companies: [companyTarget('Clim Expert')],
    }
    const { confirmActorAlias } = await import('@/lib/db/actor-alias-write')
    const res = await confirmActorAlias({
      ...baseParams(),
      alias: 'clim',
      aliasNature: 'business_alias',
    })
    expect(res.ok).toBe(true)
  })

  it('« Bessie » → BECIB en business_alias : autorisé sans geste explicite (Q5 ne gate que transcription_alias)', async () => {
    tableHandlers = {
      actor_alias: [noExisting, insertOk],
      companies: [companyTarget('BECIB')],
    }
    const { confirmActorAlias } = await import('@/lib/db/actor-alias-write')
    const res = await confirmActorAlias({
      ...baseParams(),
      alias: 'Bessie',
      aliasNature: 'business_alias',
    })
    expect(res.ok).toBe(true)
  })
})

describe('confirmActorAlias — Q5, refus (jamais confirmable, geste ou non)', () => {
  it('alias composé uniquement de stopwords → refusé', async () => {
    tableHandlers = {
      actor_alias: [noExisting],
      companies: [companyTarget('BECIB'), rows([])],
      company_contacts: [rows([])],
    }
    const { confirmActorAlias } = await import('@/lib/db/actor-alias-write')
    const res = await confirmActorAlias({
      ...baseParams(),
      alias: 'le la les',
      aliasNature: 'transcription_alias',
    })
    expect(res.ok).toBe(false)
  })

  it('alias stopwords + reinforcedConfirmation=true : refusé quand même (jamais confirmable)', async () => {
    tableHandlers = {
      actor_alias: [noExisting],
      companies: [companyTarget('BECIB'), rows([])],
      company_contacts: [rows([])],
    }
    const { confirmActorAlias } = await import('@/lib/db/actor-alias-write')
    const res = await confirmActorAlias({
      ...baseParams(),
      alias: 'le la les',
      aliasNature: 'transcription_alias',
      reinforcedConfirmation: true,
    })
    expect(res.ok).toBe(false)
  })

  it('collision exacte avec un autre acteur connu de l\'organisation → refusé, jamais confirmation silencieuse', async () => {
    tableHandlers = {
      actor_alias: [noExisting],
      company_contacts: [contactTarget('Jérôme Martin'), rows([])],
      companies: [rows([{ id: 'company-other', name: 'BECIB' }])],
    }
    const { confirmActorAlias } = await import('@/lib/db/actor-alias-write')
    const res = await confirmActorAlias({
      ...baseParams({ targetKind: 'contact', targetId: TARGET_CONTACT_ID }),
      alias: 'BECIB',
      aliasNature: 'transcription_alias',
    })
    expect(res.ok).toBe(false)
  })

  it('collision exacte + reinforcedConfirmation=true : refusé quand même', async () => {
    tableHandlers = {
      actor_alias: [noExisting],
      company_contacts: [contactTarget('Jérôme Martin'), rows([])],
      companies: [rows([{ id: 'company-other', name: 'BECIB' }])],
    }
    const { confirmActorAlias } = await import('@/lib/db/actor-alias-write')
    const res = await confirmActorAlias({
      ...baseParams({ targetKind: 'contact', targetId: TARGET_CONTACT_ID }),
      alias: 'BECIB',
      aliasNature: 'transcription_alias',
      reinforcedConfirmation: true,
    })
    expect(res.ok).toBe(false)
  })
})
