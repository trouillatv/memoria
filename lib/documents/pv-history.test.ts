// Lot 3 — Tests chronologie métier
//
// Section 1 (1-8)  : computeHistoryTransition — y compris 'réapparu'
// Section 2 (9-13) : getSubjectTimeline — gaps, réapparitions, labels canoniques
// Section 3 (14-17): getSiteHistoricalTimeline — agrégation par PV

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { computeHistoryTransition, getSubjectTimeline, getSiteHistoricalTimeline } from './pv-history'
import type { HistoryTransition } from './pv-history'

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({ from: vi.fn() }))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: mocks.from }),
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────

function prop(overrides: {
  id: string
  extraction_run_id: string
  subject_thread_id?: string
  proposal_family?: string
  document_status?: string | null
  label?: string
  target_site_id?: string | null
}) {
  return {
    target_site_id: 'site-1',
    subject_thread_id: 'thread-a',
    proposal_family: 'observation',
    document_status: 'open',
    label: 'Fissure mur',
    description: null,
    thematic_category: null,
    source_page: null,
    ...overrides,
  }
}

function run(id: string, documentId = `doc-${id}`, createdAt = `2026-0${id}-01T10:00:00Z`, targetSiteId = 'site-1') {
  return { id, document_id: documentId, created_at: createdAt, target_site_id: targetSiteId }
}

function makePropsChain(data: unknown) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data, error: null }),
    }),
  }
}

// document_extraction_run sert deux requêtes distinctes : la dérivation du site
// (select().in()) et la liste des runs canoniques (select().eq().eq().order()).
function makeRunsChain(data: unknown) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data, error: null }),
        }),
      }),
      in: vi.fn().mockResolvedValue({ data, error: null }),
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

// ─── Section 1 : computeHistoryTransition ─────────────────────────────────────

describe('computeHistoryTransition', () => {
  it('1. hasGap=true, open→open, sans résolution antérieure → réapparu', () => {
    expect(computeHistoryTransition('observation', false, 'open', 'open', true)).toBe<HistoryTransition>('réapparu')
  })

  it('2. hasGap=true, planned→done → réalisé (toStatus prime sur gap)', () => {
    expect(computeHistoryTransition('action', false, 'planned', 'done', true)).toBe<HistoryTransition>('réalisé')
  })

  it('3. open → done, observation → levé', () => {
    expect(computeHistoryTransition('observation', false, 'open', 'done', false)).toBe<HistoryTransition>('levé')
  })

  it('4. planned → done, action → réalisé', () => {
    expect(computeHistoryTransition('action', false, 'planned', 'done', false)).toBe<HistoryTransition>('réalisé')
  })

  it('5. done → in_progress → réouvert', () => {
    expect(computeHistoryTransition('observation', true, 'done', 'in_progress', false)).toBe<HistoryTransition>('réouvert')
  })

  it('6. open → non_compliant → aggravé', () => {
    expect(computeHistoryTransition('reservation', false, 'open', 'non_compliant', false)).toBe<HistoryTransition>('aggravé')
  })

  it('7. planned → in_progress → progressé', () => {
    expect(computeHistoryTransition('action', false, 'planned', 'in_progress', false)).toBe<HistoryTransition>('progressé')
  })

  it('8. open → open → maintenu', () => {
    expect(computeHistoryTransition('observation', false, 'open', 'open', false)).toBe<HistoryTransition>('maintenu')
  })

  // D1 fix : resolved → gap → open = réouvert (jamais réapparu)
  it('D1. hasGap=true, prevResolved=true, done→open → réouvert (correction D1)', () => {
    expect(computeHistoryTransition('action', true, 'done', 'open', true)).toBe<HistoryTransition>('réouvert')
  })

  it('D1. hasGap=true, prevResolved=true, null→open (via unknown intermédiaire) → réouvert', () => {
    expect(computeHistoryTransition('action', true, null, 'open', true)).toBe<HistoryTransition>('réouvert')
  })

  it('D1 sans gap. prevResolved=true, null→open → réouvert', () => {
    expect(computeHistoryTransition('action', true, null, 'open', false)).toBe<HistoryTransition>('réouvert')
  })

  it('hasGap=true, prevResolved=null, open→unknown → réapparu (pas de résolution antérieure)', () => {
    expect(computeHistoryTransition('action', null, null, null, true)).toBe<HistoryTransition>('réapparu')
  })
})

// ─── Section 2 : getSubjectTimeline ──────────────────────────────────────────

describe('getSubjectTimeline', () => {
  beforeEach(() => vi.clearAllMocks())

  it('9. chronologie simple 3 PV consécutifs — pas de gap', async () => {
    const runs = [run('1'), run('2'), run('3')]
    const props = [
      prop({ id: 'p1', extraction_run_id: '1', document_status: 'open' }),
      prop({ id: 'p2', extraction_run_id: '2', document_status: 'in_progress' }),
      prop({ id: 'p3', extraction_run_id: '3', document_status: 'done', proposal_family: 'observation' }),
    ]

    mocks.from.mockImplementation((table: string) => {
      if (table === 'document_extraction_proposal') return makePropsChain(props)
      return makeRunsChain(runs)
    })

    const timeline = await getSubjectTimeline('thread-a')
    expect(timeline).not.toBeNull()
    expect(timeline!.occurrences).toHaveLength(3)

    const [o1, o2, o3] = timeline!.occurrences
    expect(o1.transition).toBeNull()         // première occurrence
    expect(o2.transition).toBe('changé')     // open → in_progress
    expect(o3.transition).toBe('levé')       // in_progress → done (observation)
    expect(o3.isGap).toBe(false)
  })

  it('10. sujet absent du PV2 → non_mentionné entre deux occurrences', async () => {
    const runs = [run('1'), run('2'), run('3')]
    const props = [
      prop({ id: 'p1', extraction_run_id: '1', document_status: 'open' }),
      // run-2 : absent
      prop({ id: 'p3', extraction_run_id: '3', document_status: 'open' }),
    ]

    mocks.from.mockImplementation((table: string) => {
      if (table === 'document_extraction_proposal') return makePropsChain(props)
      return makeRunsChain(runs)
    })

    const timeline = await getSubjectTimeline('thread-a')
    expect(timeline!.occurrences).toHaveLength(3)

    const [o1, o2, o3] = timeline!.occurrences
    expect(o1.transition).toBeNull()
    expect(o2.isGap).toBe(true)
    expect(o2.transition).toBe('non_mentionné')
    expect(o3.transition).toBe('réapparu')  // retour après absence
    expect(o3.isGap).toBe(false)
  })

  it('11. sujet absent depuis le dernier PV — non_mentionné en fin de chronologie', async () => {
    const runs = [run('1'), run('2'), run('3')]
    const props = [
      prop({ id: 'p1', extraction_run_id: '1', document_status: 'open' }),
    ]

    mocks.from.mockImplementation((table: string) => {
      if (table === 'document_extraction_proposal') return makePropsChain(props)
      return makeRunsChain(runs)
    })

    const timeline = await getSubjectTimeline('thread-a')
    expect(timeline!.occurrences).toHaveLength(3)
    expect(timeline!.occurrences[0].isGap).toBe(false)
    expect(timeline!.occurrences[1].isGap).toBe(true)
    expect(timeline!.occurrences[2].isGap).toBe(true)

    // La non-mention n'est JAMAIS interprétée comme "levé"
    expect(timeline!.occurrences[1].transition).toBe('non_mentionné')
    expect(timeline!.occurrences[2].transition).toBe('non_mentionné')
  })

  it('12. label canonique = label de la dernière occurrence réelle', async () => {
    const runs = [run('1'), run('2')]
    const props = [
      prop({ id: 'p1', extraction_run_id: '1', label: 'Fissure façade nord', document_status: 'open' }),
      prop({ id: 'p2', extraction_run_id: '2', label: 'Fissure façade nord (confirmée)', document_status: 'non_compliant' }),
    ]

    mocks.from.mockImplementation((table: string) => {
      if (table === 'document_extraction_proposal') return makePropsChain(props)
      return makeRunsChain(runs)
    })

    const timeline = await getSubjectTimeline('thread-a')
    expect(timeline!.canonicalLabel).toBe('Fissure façade nord (confirmée)')
    expect(timeline!.currentStatus).toBe('non_compliant')
  })

  it('13. subject_thread_id inconnu → null', async () => {
    mocks.from.mockImplementation(() => makePropsChain([]))

    const timeline = await getSubjectTimeline('thread-unknown')
    expect(timeline).toBeNull()
  })

  // P0-J.2 : document_extraction_proposal.target_site_id est NULL en base pour
  // tous les threads (y compris les threads légitimement non canonicalisés) —
  // le site doit se dériver via extraction_run_id → document_extraction_run,
  // jamais via la colonne target_site_id de la proposition elle-même.
  it("13b. site dérivé via document_extraction_run même si document_extraction_proposal.target_site_id est NULL", async () => {
    const runs = [run('1')]
    const props = [
      prop({ id: 'p1', extraction_run_id: '1', document_status: 'open', target_site_id: null }),
    ]

    mocks.from.mockImplementation((table: string) => {
      if (table === 'document_extraction_proposal') return makePropsChain(props)
      return makeRunsChain(runs)
    })

    const timeline = await getSubjectTimeline('thread-a')
    expect(timeline).not.toBeNull()
    expect(timeline!.occurrences).toHaveLength(1)
  })
})

// ─── Section 3 : getSiteHistoricalTimeline ────────────────────────────────────

describe('getSiteHistoricalTimeline', () => {
  beforeEach(() => vi.clearAllMocks())

  it('14. premier run → tous nouveau', async () => {
    const runs = [run('1')]
    const props = [
      { id: 'p1', extraction_run_id: '1', subject_thread_id: 'ta', proposal_family: 'observation', document_status: 'open' },
      { id: 'p2', extraction_run_id: '1', subject_thread_id: 'tb', proposal_family: 'action', document_status: 'planned' },
    ]

    let call = 0
    mocks.from.mockImplementation((table: string) => {
      if (table === 'document_extraction_run') return makeRunsChain(runs)
      return makePropsInChain(call++ === 0 ? props : [])
    })

    const result = await getSiteHistoricalTimeline('site-1')
    expect(result.snapshots).toHaveLength(1)
    const snap = result.snapshots[0]
    expect(snap.isFirstRun).toBe(true)
    expect(snap.transitionCounts.nouveau).toBe(2)
    expect(snap.transitionCounts.maintenu).toBeUndefined()
  })

  it('15. deux runs — transitions correctes (maintenu, levé, nouveau)', async () => {
    const runs = [run('1'), run('2')]
    const props = [
      // run-1 : 3 sujets
      { id: 'p1', extraction_run_id: '1', subject_thread_id: 'ta', proposal_family: 'observation', document_status: 'open' },
      { id: 'p2', extraction_run_id: '1', subject_thread_id: 'tb', proposal_family: 'observation', document_status: 'open' },
      { id: 'p3', extraction_run_id: '1', subject_thread_id: 'tc', proposal_family: 'action', document_status: 'planned' },
      // run-2 : ta fermé, tb maintenu, tc absent, td nouveau
      { id: 'p4', extraction_run_id: '2', subject_thread_id: 'ta', proposal_family: 'observation', document_status: 'done' },
      { id: 'p5', extraction_run_id: '2', subject_thread_id: 'tb', proposal_family: 'observation', document_status: 'open' },
      { id: 'p6', extraction_run_id: '2', subject_thread_id: 'td', proposal_family: 'action', document_status: 'planned' },
    ]

    mocks.from.mockImplementation((table: string) => {
      if (table === 'document_extraction_run') return makeRunsChain(runs)
      return makePropsInChain(props)
    })

    const result = await getSiteHistoricalTimeline('site-1')
    expect(result.snapshots).toHaveLength(2)

    const snap1 = result.snapshots[0]
    expect(snap1.isFirstRun).toBe(true)
    expect(snap1.transitionCounts.nouveau).toBe(3)

    const snap2 = result.snapshots[1]
    expect(snap2.transitionCounts.levé).toBe(1)      // ta: open → done (observation)
    expect(snap2.transitionCounts.maintenu).toBe(1)   // tb: open → open
    expect(snap2.transitionCounts.non_mentionné).toBe(1)  // tc: disparu
    expect(snap2.transitionCounts.nouveau).toBe(1)    // td: nouveauté
  })

  it('16. site vide → snapshots vides', async () => {
    mocks.from.mockImplementation(() => makeRunsChain([]))

    const result = await getSiteHistoricalTimeline('site-vide')
    expect(result.snapshots).toHaveLength(0)
  })

  it('17. non_mentionné ≠ levé dans getSiteHistoricalTimeline', async () => {
    const runs = [run('1'), run('2')]
    const props = [
      // run-1 : subject open
      { id: 'p1', extraction_run_id: '1', subject_thread_id: 'ta', proposal_family: 'observation', document_status: 'open' },
      // run-2 : absent
    ]

    mocks.from.mockImplementation((table: string) => {
      if (table === 'document_extraction_run') return makeRunsChain(runs)
      return makePropsInChain(props)
    })

    const result = await getSiteHistoricalTimeline('site-1')
    const snap2 = result.snapshots[1]
    // L'absence ne doit JAMAIS produire 'levé', uniquement 'non_mentionné'
    expect(snap2.transitionCounts.non_mentionné).toBe(1)
    expect(snap2.transitionCounts.levé).toBeUndefined()
    expect(snap2.transitionCounts.réalisé).toBeUndefined()
  })
})
