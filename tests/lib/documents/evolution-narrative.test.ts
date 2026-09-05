// P1-PERF-A — narration Évolution non bloquante + réutilisée par fingerprint métier.
// Tests UNITAIRES purs : fingerprint (stabilité/sensibilité), fallback déterministe
// complet, erreur LLM → fallback, cache hit/miss, jamais-persister-le-fallback,
// single-flight. Aucune DB réelle, aucun appel IA réel.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/services/ai/factory', () => ({ getAIProvider: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

import {
  computeEvolutionNarrativeFingerprint,
  buildDeterministicNarrative,
  generateEvolutionNarrative,
  type EvolutionReadModel,
  type EvolutionSubjectFact,
} from '@/lib/documents/pv-evolution'
import { getCachedEvolutionNarrative, ensureEvolutionNarrative } from '@/lib/documents/evolution-narrative-cache'
import { getAIProvider } from '@/services/ai/factory'
import { createAdminClient } from '@/lib/supabase/admin'

function fact(id: string, label: string): EvolutionSubjectFact {
  return { canonicalSubjectId: id, label, hasActions: false, hasReserves: false, hasDecisions: false, hasDeadlines: false, openActions: 0, openReserves: 0 }
}

function makeReadModel(overrides?: Partial<EvolutionReadModel>): EvolutionReadModel {
  return {
    siteId: 'site-1',
    totalRuns: 3,
    dateRange: { start: '2026-01-01', end: '2026-03-01' },
    periods: [
      {
        label: 'PV1 → PV2', startDate: '2026-01-01', endDate: '2026-02-01',
        pvNumbers: [1, 2], runIds: ['r1', 'r2'], isSilence: false,
        appeared: [fact('cs-a', 'Sprinkler')], reopened: [], aggravated: [], resolved: [],
        stillOpen: [fact('cs-b', 'Désenfumage')], importanceScore: 4,
      },
      {
        label: 'Silence', startDate: '2026-02-01', endDate: '2026-03-01',
        pvNumbers: [], runIds: [], isSilence: true, silenceDays: 28,
        appeared: [], reopened: [], aggravated: [], resolved: [], stillOpen: [], importanceScore: 0,
      },
    ],
    ...overrides,
  }
}

// ── Fingerprint ───────────────────────────────────────────────────────────────

describe('computeEvolutionNarrativeFingerprint — même matière, même empreinte', () => {
  it('deux read-models métier identiques (objets distincts) → même empreinte', () => {
    expect(computeEvolutionNarrativeFingerprint(makeReadModel()))
      .toBe(computeEvolutionNarrativeFingerprint(makeReadModel()))
  })

  it('empreinte = hex sha256 (64 caractères)', () => {
    expect(computeEvolutionNarrativeFingerprint(makeReadModel())).toMatch(/^[0-9a-f]{64}$/)
  })

  it('un libellé de sujet change → empreinte différente', () => {
    const m = makeReadModel()
    m.periods[0].appeared[0] = fact('cs-a', 'Sprinkler — local surpresseur')
    expect(computeEvolutionNarrativeFingerprint(m)).not.toBe(computeEvolutionNarrativeFingerprint(makeReadModel()))
  })

  it('une transition change (résolu ↔ encore ouvert) → empreinte différente', () => {
    const m = makeReadModel()
    m.periods[0].resolved = m.periods[0].stillOpen
    m.periods[0].stillOpen = []
    expect(computeEvolutionNarrativeFingerprint(m)).not.toBe(computeEvolutionNarrativeFingerprint(makeReadModel()))
  })

  it('les jours de silence changent → empreinte différente', () => {
    const m = makeReadModel()
    m.periods[1].silenceDays = 45
    expect(computeEvolutionNarrativeFingerprint(m)).not.toBe(computeEvolutionNarrativeFingerprint(makeReadModel()))
  })
})

// ── Fallback déterministe ─────────────────────────────────────────────────────

describe('buildDeterministicNarrative — complet sans LLM', () => {
  it('une entrée par période, deterministic=true, model=null, textes non vides', () => {
    const n = buildDeterministicNarrative(makeReadModel())
    expect(n.deterministic).toBe(true)
    expect(n.model).toBeNull()
    expect(n.periods).toHaveLength(2)
    for (const p of n.periods) expect(p.text.length).toBeGreaterThan(0)
    expect(n.periods[0].supportingSubjectIds).toContain('cs-a')
  })
})

// ── Erreur LLM → fallback, jamais bloquant ────────────────────────────────────

describe('generateEvolutionNarrative — le LLM ne conditionne jamais la vérité', () => {
  beforeEach(() => vi.mocked(getAIProvider).mockReset())

  it('provider en échec → fallback déterministe, aucune exception', async () => {
    vi.mocked(getAIProvider).mockReturnValue({
      name: 'gemini', complete: vi.fn().mockRejectedValue(new Error('LLM down')),
    } as never)
    const n = await generateEvolutionNarrative(makeReadModel())
    expect(n.deterministic).toBe(true)
    expect(n.periods).toHaveLength(2)
  })

  it('provider mock → fallback sans appel', async () => {
    const complete = vi.fn()
    vi.mocked(getAIProvider).mockReturnValue({ name: 'mock', complete } as never)
    const n = await generateEvolutionNarrative(makeReadModel())
    expect(n.deterministic).toBe(true)
    expect(complete).not.toHaveBeenCalled()
  })
})

// ── Cache : lecture, écriture conditionnelle, single-flight ───────────────────

type UpsertSpy = ReturnType<typeof vi.fn>
function stubAdmin(row: { model: string; periods: unknown[] } | null): { upsert: UpsertSpy } {
  const upsert = vi.fn().mockResolvedValue({ data: null, error: null })
  vi.mocked(createAdminClient).mockReturnValue({
    from: () => ({
      upsert,
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row }) }) }) }),
    }),
  } as never)
  return { upsert }
}

describe('getCachedEvolutionNarrative', () => {
  it('hit → narration IA (deterministic=false) reconstruite depuis la ligne', async () => {
    stubAdmin({ model: 'gemini-x', periods: [{ periodLabel: 'PV1 → PV2', text: 'Texte IA.', supportingSubjectIds: [] }] })
    const n = await getCachedEvolutionNarrative('site-1', 'fp')
    expect(n).not.toBeNull()
    expect(n!.deterministic).toBe(false)
    expect(n!.model).toBe('gemini-x')
  })

  it('miss → null', async () => {
    stubAdmin(null)
    expect(await getCachedEvolutionNarrative('site-1', 'fp')).toBeNull()
  })
})

describe('ensureEvolutionNarrative', () => {
  beforeEach(() => vi.mocked(getAIProvider).mockReset())

  it('narration LLM réelle → persistée (upsert ignoreDuplicates)', async () => {
    const { upsert } = stubAdmin(null)
    vi.mocked(getAIProvider).mockReturnValue({
      name: 'gemini',
      complete: vi.fn().mockResolvedValue({
        model: 'gemini-x', text: '',
        parsed: { periods: [{ periodLabel: 'PV1 → PV2', text: 'Une narration factuelle.', supportingSubjectIds: [] }] },
      }),
    } as never)
    await ensureEvolutionNarrative('site-1', makeReadModel(), 'fp-persist')
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(upsert.mock.calls[0][0]).toMatchObject({ site_id: 'site-1', fingerprint: 'fp-persist', model: 'gemini-x' })
    expect(upsert.mock.calls[0][1]).toMatchObject({ onConflict: 'site_id,fingerprint', ignoreDuplicates: true })
  })

  it('fallback déterministe (mock/échec LLM) → JAMAIS persisté', async () => {
    const { upsert } = stubAdmin(null)
    vi.mocked(getAIProvider).mockReturnValue({ name: 'mock', complete: vi.fn() } as never)
    await ensureEvolutionNarrative('site-1', makeReadModel(), 'fp-mock')
    expect(upsert).not.toHaveBeenCalled()
  })

  it('single-flight : deux appels simultanés même fingerprint → 1 seul appel LLM', async () => {
    stubAdmin(null)
    let resolveLlm!: (v: unknown) => void
    const complete = vi.fn().mockReturnValue(new Promise((r) => { resolveLlm = r }))
    vi.mocked(getAIProvider).mockReturnValue({ name: 'gemini', complete } as never)
    const p1 = ensureEvolutionNarrative('site-1', makeReadModel(), 'fp-flight')
    const p2 = ensureEvolutionNarrative('site-1', makeReadModel(), 'fp-flight')
    expect(p2).toBe(p1)
    resolveLlm({ model: 'gemini-x', text: '', parsed: { periods: [{ periodLabel: 'PV1 → PV2', text: 'Une narration factuelle.', supportingSubjectIds: [] }] } })
    await Promise.all([p1, p2])
    expect(complete).toHaveBeenCalledTimes(1)
  })
})
