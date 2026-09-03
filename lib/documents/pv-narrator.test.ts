// Lot 4 — Tests narration copilote
//
// Section 1 (1-6)  : buildSincePvStructure — groupement déterministe des transitions
// Section 2 (7-10) : generateSincePvSummary — avec/sans clé API
// Section 3 (11-14): generateSiteHistoryNarrative — chargement DB + structure périodes

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildSincePvStructure, generateSincePvSummary, generateSiteHistoryNarrative } from './pv-narrator'
import type { PvDelta } from './pv-comparison'

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  fetch: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: mocks.from }),
}))

vi.stubGlobal('fetch', mocks.fetch)

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDelta(items: PvDelta['items']): PvDelta {
  return { fromRunId: 'from-run', toRunId: 'to-run', items }
}

function deltaItem(overrides: Partial<PvDelta['items'][0]> & { transition: PvDelta['items'][0]['transition'] }) {
  return {
    subjectThreadId: `t-${Math.random()}`,
    family: 'observation',
    thematicCategory: null,
    label: 'Fissure façade',
    fromStatus: 'open',
    toStatus: 'done',
    fromProposalId: 'from-p',
    toProposalId: 'to-p',
    ...overrides,
  }
}

function makeRunsChain(data: unknown) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data, error: null }),
        }),
      }),
    }),
  }
}

function makePropsInChain(data: unknown) {
  return {
    select: vi.fn().mockReturnValue({
      in: vi.fn().mockReturnValue({
        not: vi.fn().mockResolvedValue({ data, error: null }),
      }),
    }),
  }
}

function mockLlmSuccess(text: string) {
  mocks.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
  })
}

// ─── Section 1 : buildSincePvStructure ────────────────────────────────────────

describe('buildSincePvStructure', () => {
  it('1. groupement basique — levé et réalisé séparés', () => {
    const delta = makeDelta([
      deltaItem({ transition: 'levé', label: 'Réserve R4', fromProposalId: 'f1', toProposalId: 't1' }),
      deltaItem({ transition: 'réalisé', label: 'Couche de forme', fromProposalId: 'f2', toProposalId: 't2' }),
    ])
    const struct = buildSincePvStructure(delta)
    expect(struct.levé).toHaveLength(1)
    expect(struct.réalisé).toHaveLength(1)
    expect(struct.levé![0].label).toBe('Réserve R4')
    expect(struct.réalisé![0].proposalId).toBe('t2')  // toProposalId prioritaire
  })

  it('2. non_mentionné groupé séparément', () => {
    const delta = makeDelta([
      deltaItem({ transition: 'non_mentionné', label: 'Rapport G3', toProposalId: null }),
      deltaItem({ transition: 'maintenu', label: 'Busage', toProposalId: 'tp1' }),
    ])
    const struct = buildSincePvStructure(delta)
    expect(struct.non_mentionné).toHaveLength(1)
    expect(struct.maintenu).toHaveLength(1)
    // non_mentionné n'est JAMAIS classé en levé
    expect(struct.levé).toBeUndefined()
  })

  it('3. proposalId = fromProposalId si toProposalId est null (non_mentionné)', () => {
    const delta = makeDelta([
      deltaItem({ transition: 'non_mentionné', fromProposalId: 'fp1', toProposalId: null }),
    ])
    const struct = buildSincePvStructure(delta)
    expect(struct.non_mentionné![0].proposalId).toBe('fp1')
  })

  it('4. delta vide → structure vide', () => {
    const struct = buildSincePvStructure(makeDelta([]))
    expect(Object.keys(struct)).toHaveLength(0)
  })

  it('5. plusieurs items de même transition → groupés dans le même tableau', () => {
    const delta = makeDelta([
      deltaItem({ transition: 'nouveau', label: 'Sujet A' }),
      deltaItem({ transition: 'nouveau', label: 'Sujet B' }),
      deltaItem({ transition: 'nouveau', label: 'Sujet C' }),
    ])
    const struct = buildSincePvStructure(delta)
    expect(struct.nouveau).toHaveLength(3)
  })

  it('6. fromStatus/toStatus conservés dans la structure', () => {
    const delta = makeDelta([
      deltaItem({ transition: 'aggravé', fromStatus: 'open', toStatus: 'non_compliant' }),
    ])
    const struct = buildSincePvStructure(delta)
    expect(struct.aggravé![0].fromStatus).toBe('open')
    expect(struct.aggravé![0].toStatus).toBe('non_compliant')
  })
})

// ─── Section 2 : generateSincePvSummary ──────────────────────────────────────

describe('generateSincePvSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  it('7. sans clé API — structure retournée, narrative null', async () => {
    vi.stubEnv('GOOGLE_GENAI_API_KEY', '')
    const delta = makeDelta([
      deltaItem({ transition: 'réalisé', label: 'Couche de forme' }),
    ])
    const result = await generateSincePvSummary(delta)
    expect(result.structure.réalisé).toHaveLength(1)
    expect(result.narrative).toBeNull()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('8. delta vide → narrative null (même avec clé API)', async () => {
    vi.stubEnv('GOOGLE_GENAI_API_KEY', 'test-key')
    const result = await generateSincePvSummary(makeDelta([]))
    expect(result.narrative).toBeNull()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('9. avec clé API et delta non vide → narrative générée', async () => {
    vi.stubEnv('GOOGLE_GENAI_API_KEY', 'test-key')
    mockLlmSuccess('Bonne progression sur le chantier ce mois-ci.')

    const delta = makeDelta([
      deltaItem({ transition: 'levé', label: 'Réserve R4' }),
      deltaItem({ transition: 'non_mentionné', label: 'Rapport G3', toProposalId: null }),
    ])
    const result = await generateSincePvSummary(delta)
    expect(result.narrative).toBe('Bonne progression sur le chantier ce mois-ci.')
    expect(result.structure.levé).toHaveLength(1)
    expect(result.structure.non_mentionné).toHaveLength(1)
  })

  it('10. erreur LLM → narrative null, structure préservée', async () => {
    vi.stubEnv('GOOGLE_GENAI_API_KEY', 'test-key')
    mocks.fetch.mockResolvedValue({ ok: false })

    const delta = makeDelta([deltaItem({ transition: 'réalisé' })])
    const result = await generateSincePvSummary(delta)
    expect(result.narrative).toBeNull()
    expect(result.structure.réalisé).toHaveLength(1)
  })
})

// ─── Section 3 : generateSiteHistoryNarrative ────────────────────────────────

describe('generateSiteHistoryNarrative', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  it('11. site sans run → periods vides, narrative null', async () => {
    mocks.from.mockImplementation(() => makeRunsChain([]))

    const result = await generateSiteHistoryNarrative('site-vide')
    expect(result.periods).toHaveLength(0)
    expect(result.narrative).toBeNull()
  })

  it('12. premier run → tous nouveau, snapshot correct', async () => {
    vi.stubEnv('GOOGLE_GENAI_API_KEY', '')

    const runs = [{ id: 'r1', document_id: 'doc-1', created_at: '2026-04-16T10:00:00Z' }]
    const props = [
      { id: 'p1', extraction_run_id: 'r1', subject_thread_id: 'ta', proposal_family: 'observation', document_status: 'open', label: 'Fissure' },
      { id: 'p2', extraction_run_id: 'r1', subject_thread_id: 'tb', proposal_family: 'action', document_status: 'planned', label: 'Rapport G3' },
    ]

    mocks.from.mockImplementation((table: string) => {
      if (table === 'document_extraction_run') return makeRunsChain(runs)
      return makePropsInChain(props)
    })

    const result = await generateSiteHistoryNarrative('site-1')
    expect(result.periods).toHaveLength(1)

    const period = result.periods[0]
    expect(period.runId).toBe('r1')
    expect(period.items.every((i) => i.transition === 'nouveau')).toBe(true)
    expect(period.items).toHaveLength(2)
  })

  it('13. deux runs — transitions calculées correctement', async () => {
    vi.stubEnv('GOOGLE_GENAI_API_KEY', '')

    const runs = [
      { id: 'r1', document_id: 'doc-1', created_at: '2026-04-16T10:00:00Z' },
      { id: 'r2', document_id: 'doc-2', created_at: '2026-04-30T10:00:00Z' },
    ]
    const props = [
      // r1 : 2 sujets
      { id: 'p1', extraction_run_id: 'r1', subject_thread_id: 'ta', proposal_family: 'observation', document_status: 'open', label: 'Fissure' },
      { id: 'p2', extraction_run_id: 'r1', subject_thread_id: 'tb', proposal_family: 'action', document_status: 'planned', label: 'Rapport G3' },
      // r2 : ta levé, tb absent
      { id: 'p3', extraction_run_id: 'r2', subject_thread_id: 'ta', proposal_family: 'observation', document_status: 'done', label: 'Fissure réparée' },
    ]

    mocks.from.mockImplementation((table: string) => {
      if (table === 'document_extraction_run') return makeRunsChain(runs)
      return makePropsInChain(props)
    })

    const result = await generateSiteHistoryNarrative('site-1')
    const period2 = result.periods[1]

    const levé = period2.items.find((i) => i.transition === 'levé')
    const nonMentionne = period2.items.find((i) => i.transition === 'non_mentionné')

    expect(levé).toBeDefined()
    expect(levé!.label).toBe('Fissure réparée')
    expect(nonMentionne).toBeDefined()
    expect(nonMentionne!.label).toBe('Rapport G3')
    // non_mentionné ne doit JAMAIS être 'levé'
    expect(period2.items.filter((i) => i.transition === 'levé')).toHaveLength(1)
  })

  it('14. avec clé API → narrative générée à partir des périodes', async () => {
    vi.stubEnv('GOOGLE_GENAI_API_KEY', 'test-key')
    mockLlmSuccess('Chronologie du chantier : démarrage en avril, avancée en mai.')

    const runs = [
      { id: 'r1', document_id: 'doc-1', created_at: '2026-04-16T10:00:00Z' },
    ]
    const props = [
      { id: 'p1', extraction_run_id: 'r1', subject_thread_id: 'ta', proposal_family: 'observation', document_status: 'open', label: 'Fissure' },
    ]

    mocks.from.mockImplementation((table: string) => {
      if (table === 'document_extraction_run') return makeRunsChain(runs)
      return makePropsInChain(props)
    })

    const result = await generateSiteHistoryNarrative('site-1')
    expect(result.narrative).toBe('Chronologie du chantier : démarrage en avril, avancée en mai.')
    expect(mocks.fetch).toHaveBeenCalledOnce()
  })

  it('15. effectiveDate utilise documents.effective_date et non created_at (import rétroactif)', async () => {
    vi.stubEnv('GOOGLE_GENAI_API_KEY', '')

    // PV avec date métier réelle = 22/07/2026, importé le 03/09/2026.
    const runs = [
      {
        id: 'r1',
        document_id: 'doc-1',
        created_at: '2026-09-03T10:00:00Z',
        documents: [{ effective_date: '2026-07-22T00:00:00Z' }],
      },
    ]
    const props = [
      { id: 'p1', extraction_run_id: 'r1', subject_thread_id: 'ta', proposal_family: 'observation', document_status: 'open', label: 'Sprinkler' },
    ]

    mocks.from.mockImplementation((table: string) => {
      if (table === 'document_extraction_run') return makeRunsChain(runs)
      return makePropsInChain(props)
    })

    const result = await generateSiteHistoryNarrative('site-rus')
    expect(result.periods).toHaveLength(1)
    // La date affichée doit être la date métier du document, pas la date d'import.
    expect(result.periods[0].effectiveDate).toBe('2026-07-22T00:00:00Z')
    expect(result.periods[0].effectiveDate).not.toBe('2026-09-03T10:00:00Z')
  })
})
