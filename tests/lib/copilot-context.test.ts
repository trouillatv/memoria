import { describe, it, expect } from 'vitest'
import {
  buildSiteCopilotContext,
  filterContextForIntent,
  buildFallbackText,
  type CopilotItem,
} from '@/lib/visits/copilot-context'
import type { SiteOverview, PvAttentionItem, PvVerifyItem, PvLastDelta, AttentionReason } from '@/lib/knowledge/site-overview'
import type { SiteAttentionItem, AttentionSignal } from '@/lib/knowledge/site-attention-items'

// ── Factories ─────────────────────────────────────────────────────────────────

function makeAttention(overrides: Partial<PvAttentionItem> & { label: string }): PvAttentionItem {
  return {
    canonicalSubjectId: 'cs-default',
    reason: 'non_conforme',
    pvCount: 2,
    href: '/sites/s1/historique/cs-default',
    ...overrides,
  }
}

function makeVerify(overrides: Partial<PvVerifyItem> & { canonicalSubjectId: string; label: string }): PvVerifyItem {
  return {
    signals: [],
    pendingLinks: 0,
    href: `/sites/s1/historique/${overrides.canonicalSubjectId}`,
    ...overrides,
  }
}

function makeAttentionReason(overrides: Partial<AttentionReason> & { id: string; title: string }): AttentionReason {
  return {
    kind: 'action_overdue',
    detail: null,
    href: null,
    ...overrides,
  }
}

function makeEngineItem(o: {
  signal: AttentionSignal
  title: string
  csId: string | null
  urgency?: SiteAttentionItem['urgency']
}): SiteAttentionItem {
  return {
    signal: o.signal,
    title: o.title,
    reason: `Signal ${o.signal}`,
    urgency: o.urgency ?? 'low',
    href: `/sites/site-1/historique/sujets/${o.csId ?? 'x'}`,
    ...(o.csId ? { metadata: { canonicalSubjectId: o.csId } } : {}),
  }
}

function makeOverview(overrides: Partial<SiteOverview> = {}): SiteOverview {
  return {
    identity: { id: 'site-1', name: 'Chantier Test', client: null, status: null },
    activity: { lastVisit: null, picture: null },
    synthesis: {
      status: 'missing', version: null, updatedAt: null, basedOn: null,
      pendingChanges: 0, pending: {} as SiteOverview['synthesis']['pending'], projectionFailed: false,
    },
    actions: {
      proposed: [], confirmed: [], completedRecent: [], priority: [],
      summary: { proposed: 0, active: 0, planned: 0, overdue: 0, week: 0, undated: 0, completed: 0 },
    },
    attention: { level: 'calm', reasons: [] },
    nextEvent: null,
    recentChanges: [],
    reserves: { open: 0 },
    blockages: { open: 0 },
    watchpoints: { proposed: [], confirmed: [], summary: { proposed: 0, confirmed: 0 } },
    deadlines: { proposed: [], confirmed: [], summary: { proposed: 0, confirmed: 0 } },
    deadlineCounts: { planned: 0, toPlan: 0 },
    stakeholders: { proposed: [], confirmed: [], summary: { proposed: 0, confirmed: 0 } },
    stakeholderCompanies: [],
    knowledge: { proposed: [], confirmed: [], summary: { proposed: 0, confirmed: 0 } },
    decisions: { proposed: [], confirmed: [], summary: { proposed: 0, confirmed: 0 } },
    history: [],
    pvAttention: [],
    pvLastDelta: null,
    pvActivity: null,
    pvToVerify: [],
    ...overrides,
  }
}

// ── Tests : buildSiteCopilotContext ───────────────────────────────────────────

describe('buildSiteCopilotContext', () => {
  it('même canonicalSubjectId dans pvAttention et pvToVerify → un seul item agrégé', () => {
    const csId = 'cs-r4'
    const overview = makeOverview({
      pvAttention: [makeAttention({ canonicalSubjectId: csId, label: 'Regard R4', pvCount: 4 })],
      pvToVerify: [makeVerify({ canonicalSubjectId: csId, label: 'Regard R4', signals: ['2 points à lever'] })],
    })
    const ctx = buildSiteCopilotContext('site-1', 'Test', overview, [])
    const subjects = ctx.items.filter((i) => i.type === 'subject')
    expect(subjects).toHaveLength(1)
    expect(subjects[0].id).toBe(csId)
    // Les faits des deux sources sont fusionnés
    expect(subjects[0].facts.some((f) => f.includes('4 PV'))).toBe(true)
    expect(subjects[0].facts.some((f) => f.includes('2 points à lever'))).toBe(true)
  })

  it('pvAttention reason=sans_évolution → intents attention ET stale', () => {
    const overview = makeOverview({
      pvAttention: [makeAttention({ canonicalSubjectId: 'cs-1', label: 'Sujet stagnant', reason: 'sans_évolution', pvCount: 3 })],
    })
    const ctx = buildSiteCopilotContext('site-1', 'Test', overview, [])
    const item = ctx.items.find((i) => i.id === 'cs-1')!
    expect(item.intents).toContain('attention')
    expect(item.intents).toContain('stale')
  })

  it('pvAttention reason=non_conforme → intent attention uniquement (pas stale)', () => {
    const overview = makeOverview({
      pvAttention: [makeAttention({ canonicalSubjectId: 'cs-nc', label: 'Non conforme', reason: 'non_conforme' })],
    })
    const ctx = buildSiteCopilotContext('site-1', 'Test', overview, [])
    const item = ctx.items.find((i) => i.id === 'cs-nc')!
    expect(item.intents).toContain('attention')
    expect(item.intents).not.toContain('stale')
  })

  it('les pendingLinks (dépendances suggested) ne sont PAS transmis comme fait', () => {
    const overview = makeOverview({
      pvToVerify: [makeVerify({
        canonicalSubjectId: 'cs-dep',
        label: 'Sujet avec dépendances suggérées',
        pendingLinks: 5,  // suggested, non confirmées
        signals: [],
      })],
    })
    const ctx = buildSiteCopilotContext('site-1', 'Test', overview, [])
    const item = ctx.items.find((i) => i.id === 'cs-dep')!
    // Les dépendances suggested ne doivent PAS être dans les faits
    expect(item.facts.some((f) => f.toLowerCase().includes('dépendance'))).toBe(false)
    expect(item.facts.some((f) => f.includes('suggérée'))).toBe(false)
  })

  it('delta.nouveaux/réouverts/aggravés/traités correspond exactement à pvLastDelta', () => {
    const pvLastDelta: PvLastDelta = {
      fromDate: '2026-06-01',
      toDate: '2026-07-01',
      nouveaux: 3,
      réouverts: 2,
      aggravés: 1,
      résolus: 5,
    }
    const overview = makeOverview({ pvLastDelta })
    const ctx = buildSiteCopilotContext('site-1', 'Test', overview, [])
    expect(ctx.delta).not.toBeNull()
    expect(ctx.delta!.nouveaux).toBe(3)    // même valeur que Histoire
    expect(ctx.delta!.réouverts).toBe(2)   // réouvert ≠ aggravé (P0 convergence)
    expect(ctx.delta!.aggravés).toBe(1)    // même valeur que Histoire
    expect(ctx.delta!.traités).toBe(5)     // même valeur que Histoire
  })

  it('PV8 02/07 + PV9 16/07 → delta.fromDate = PV précédent, delta.toDate = PV analysé', () => {
    // Invariant : fromDate est le PV de référence (PV8), toDate est le PV analysé (PV9).
    // Le LLM ne doit jamais présenter fromDate comme étant la date du dernier PV.
    const pvLastDelta: PvLastDelta = {
      fromDate: '2026-07-02',
      toDate: '2026-07-16',
      nouveaux: 6,
      réouverts: 0,
      aggravés: 0,
      résolus: 1,
    }
    const overview = makeOverview({ pvLastDelta })
    const ctx = buildSiteCopilotContext('site-1', 'OCEF', overview, [])
    expect(ctx.delta).not.toBeNull()
    expect(ctx.delta!.fromDate).toBe('2026-07-02') // PV précédent (référence)
    expect(ctx.delta!.toDate).toBe('2026-07-16')   // PV analysé (le plus récent)
    expect(ctx.delta!.nouveaux).toBe(6)
    expect(ctx.delta!.traités).toBe(1)
  })

  it('pvLastDelta null → delta null', () => {
    const ctx = buildSiteCopilotContext('site-1', 'Test', makeOverview(), [])
    expect(ctx.delta).toBeNull()
  })

  it('prepItems dans le contexte = exactement les prepItems passés en entrée', () => {
    const prepItems = [
      { label: 'Regard R4', stableKey: 'attention:cs-r4' },
      { label: 'Vérifier G3', stableKey: 'manual:uuid-xyz' },
    ]
    const ctx = buildSiteCopilotContext('site-1', 'Test', makeOverview(), prepItems)
    expect(ctx.prepItems).toHaveLength(2)
    expect(ctx.prepItems[0].stableKey).toBe('attention:cs-r4')
    expect(ctx.prepItems[1].stableKey).toBe('manual:uuid-xyz')
  })

  it('event_upcoming dans attention.reasons est exclu du contexte copilote', () => {
    const overview = makeOverview({
      attention: {
        level: 'watch',
        reasons: [makeAttentionReason({ id: 'evt-1', title: 'Réunion demain', kind: 'event_upcoming' })],
      },
    })
    const ctx = buildSiteCopilotContext('site-1', 'Test', overview, [])
    expect(ctx.items.find((i) => i.id === 'evt-1')).toBeUndefined()
  })

  it('les items n\'ont que les types autorisés (pas de person/company/knowledge_fact)', () => {
    const overview = makeOverview({
      pvAttention: [makeAttention({ canonicalSubjectId: 'cs-1', label: 'Sujet A' })],
      attention: {
        level: 'watch',
        reasons: [makeAttentionReason({ id: 'act-1', title: 'Action en retard', kind: 'action_overdue' })],
      },
    })
    const ctx = buildSiteCopilotContext('site-1', 'Test', overview, [])
    const allowedTypes = new Set(['subject', 'action', 'deadline', 'signal'])
    expect(ctx.items.every((i) => allowedTypes.has(i.type))).toBe(true)
  })
})

// ── Tests : filterContextForIntent ────────────────────────────────────────────

describe('filterContextForIntent', () => {
  it('attention retourne uniquement les items avec intent attention', () => {
    const ctx = buildSiteCopilotContext('site-1', 'Test', makeOverview({
      pvAttention: [makeAttention({ canonicalSubjectId: 'cs-1', label: 'A' })],
      pvToVerify: [makeVerify({ canonicalSubjectId: 'cs-only-verify', label: 'B' })],
    }), [])
    const { items } = filterContextForIntent(ctx, 'attention')
    expect(items.every((i) => i.intents.includes('attention'))).toBe(true)
    expect(items.find((i) => i.id === 'cs-only-verify')).toBeUndefined()
  })

  it('next_visit inclut les prepItems du contexte', () => {
    const prepItems = [{ label: 'Vérifier R4', stableKey: 'attention:cs-r4' }]
    const ctx = buildSiteCopilotContext('site-1', 'Test', makeOverview({
      pvToVerify: [makeVerify({ canonicalSubjectId: 'cs-r4', label: 'Regard R4' })],
    }), prepItems)
    const { prepItems: filtered } = filterContextForIntent(ctx, 'next_visit')
    expect(filtered).toHaveLength(1)
    expect(filtered[0].stableKey).toBe('attention:cs-r4')
  })

  it('respecte la limite de 8 items par intention', () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      makeAttention({ canonicalSubjectId: `cs-${i}`, label: `Sujet ${i}` }),
    )
    const ctx = buildSiteCopilotContext('site-1', 'Test', makeOverview({ pvAttention: many }), [])
    const { items } = filterContextForIntent(ctx, 'attention')
    expect(items.length).toBeLessThanOrEqual(8)
  })

  // Régression PETRO ATTITI (recette du 2026-08-15) : un chantier suivi en
  // visites terrain, sans aucun PV analysé, produisait un plan de visite VIDE —
  // MemorIA demandait à l'utilisateur ce qu'il fallait vérifier au lieu de le
  // lui dire. Cause : aucun signal du moteur canonique ne portait `next_visit`,
  // donc seul `overview.pvToVerify` (moteur PV) pouvait alimenter l'intention.
  it('next_visit est alimenté par le moteur canonique seul, sans aucun PV', () => {
    const ctx = buildSiteCopilotContext('site-1', 'Test', makeOverview(), [], [
      makeEngineItem({ signal: 'subject_changed', title: 'Terrassement zone B', csId: 'cs-terr' }),
      makeEngineItem({ signal: 'subject_stagnant', title: 'Regard R4', csId: 'cs-r4' }),
      makeEngineItem({ signal: 'reserve_open', title: 'Réserve façade', csId: 'cs-fac' }),
    ])
    const { items } = filterContextForIntent(ctx, 'next_visit')
    expect(items.length).toBe(3)
    expect(items.map((i) => i.label)).toContain('Terrassement zone B')
  })

  it('les signaux de back-office ne rentrent pas dans un plan de visite', () => {
    const ctx = buildSiteCopilotContext('site-1', 'Test', makeOverview(), [], [
      makeEngineItem({ signal: 'proposal_pending', title: '3 propositions à valider', csId: null }),
      makeEngineItem({ signal: 'link_suggested', title: '2 liens suggérés', csId: null }),
      makeEngineItem({ signal: 'actor_congestion', title: 'Entreprise X surchargée', csId: null }),
    ])
    expect(filterContextForIntent(ctx, 'next_visit').items).toHaveLength(0)
    // …mais ils restent des points d'attention : le lot ne retire rien.
    expect(filterContextForIntent(ctx, 'attention').items).toHaveLength(3)
  })

  it('changes ne retourne prepItems que pour next_visit', () => {
    const prepItems = [{ label: 'Point plan', stableKey: 'manual:x' }]
    const ctx = buildSiteCopilotContext('site-1', 'Test', makeOverview({
      pvLastDelta: { fromDate: '2026-06-01', toDate: '2026-07-01', nouveaux: 1, réouverts: 0, aggravés: 0, résolus: 0 },
    }), prepItems)
    const { prepItems: filtered } = filterContextForIntent(ctx, 'changes')
    expect(filtered).toHaveLength(0)
  })
})

// ── Tests : buildFallbackText ─────────────────────────────────────────────────

describe('buildFallbackText', () => {
  it('attention avec sujets → liste les sujets avec leurs faits', () => {
    const items: CopilotItem[] = [
      { type: 'subject', id: 'cs-1', label: 'Regard R4', facts: ['Présent dans 4 PV'], href: null, intents: ['attention'] },
    ]
    const text = buildFallbackText(items, 'attention', null, [])
    expect(text).toContain('Regard R4')
    expect(text).toContain('4 PV')
    expect(text).not.toBe('')
  })

  it('changes avec delta → reprend les chiffres (réouvert ≠ aggravé) et les deux bornes de date', () => {
    const delta = { fromDate: '2026-07-02', toDate: '2026-07-16', nouveaux: 3, réouverts: 2, aggravés: 1, traités: 4 }
    const text = buildFallbackText([], 'changes', delta, [])
    expect(text).toContain('3')
    expect(text).toContain('2 rouvert')
    expect(text).toContain('1 aggravé')
    expect(text).toContain('4 traité')
    // Les deux bornes doivent apparaître — fromDate est le PV de référence, pas le dernier
    expect(text).toMatch(/2 juil/)
    expect(text).toMatch(/16 juil/)
  })

  it('changes sans delta → message neutre (pas une erreur)', () => {
    const text = buildFallbackText([], 'changes', null, [])
    expect(text.length).toBeGreaterThan(0)
    expect(text.toLowerCase()).not.toContain('erreur')
    expect(text.toLowerCase()).not.toContain('indisponible')
  })

  it('next_visit avec prepItems → mentionne le plan de visite actif', () => {
    const prepItems = [{ label: 'Regard R4', stableKey: 'attention:cs-r4' }]
    const text = buildFallbackText([], 'next_visit', null, prepItems)
    expect(text).toContain('Regard R4')
  })

  it('stale sans sujets → message neutre (pas une erreur technique)', () => {
    const text = buildFallbackText([], 'stale', null, [])
    expect(text.length).toBeGreaterThan(0)
    expect(text.toLowerCase()).not.toContain('erreur')
  })
})
