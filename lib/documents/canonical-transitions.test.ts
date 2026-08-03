// Tests du moteur canonique de transitions inter-PV.
//
// Couvre :
//   - computeCanonicalCellState  (12 cas)
//   - computeCanonicalTransition (12 cas)
//   - getCanonicalDelta          (5 cas d'intégration avec mock Supabase)
//     · plusieurs threads → un seul canonical
//     · canonicals distincts restent distincts
//     · thread sans canonical_subject_id → ignoré
//     · toutes familles exclues → canonical exclu
//     · mêmes transitions fondamentales que computeCanonicalTransition

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  computeCanonicalCellState,
  computeCanonicalTransition,
  getCanonicalDelta,
} from './canonical-transitions'
import type { CanonicalCellState, CanonicalTransition } from './canonical-transitions'

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({ from: vi.fn() }))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: mocks.from }),
}))

// ─── Section 1 : computeCanonicalCellState ───────────────────────────────────

describe('computeCanonicalCellState', () => {
  it('1. prevStatus null → first', () => {
    expect(computeCanonicalCellState(null, 'open')).toBe<CanonicalCellState>('first')
  })

  it('2. prevStatus null + done → first (premier run, même si done)', () => {
    expect(computeCanonicalCellState(null, 'done')).toBe<CanonicalCellState>('first')
  })

  it('3. open → non_compliant → non_compliant', () => {
    expect(computeCanonicalCellState('open', 'non_compliant')).toBe<CanonicalCellState>('non_compliant')
  })

  it('4. done → non_compliant → non_compliant (sévérité du statut courant prime)', () => {
    expect(computeCanonicalCellState('done', 'non_compliant')).toBe<CanonicalCellState>('non_compliant')
  })

  it('5. open → done → done', () => {
    expect(computeCanonicalCellState('open', 'done')).toBe<CanonicalCellState>('done')
  })

  it('6. open → cancelled → done', () => {
    expect(computeCanonicalCellState('open', 'cancelled')).toBe<CanonicalCellState>('done')
  })

  it('7. open → informational → done', () => {
    expect(computeCanonicalCellState('open', 'informational')).toBe<CanonicalCellState>('done')
  })

  it('8. done → open → reopened', () => {
    expect(computeCanonicalCellState('done', 'open')).toBe<CanonicalCellState>('reopened')
  })

  it('9. cancelled → in_progress → reopened', () => {
    expect(computeCanonicalCellState('cancelled', 'in_progress')).toBe<CanonicalCellState>('reopened')
  })

  it('10. open → open → open', () => {
    expect(computeCanonicalCellState('open', 'open')).toBe<CanonicalCellState>('open')
  })

  it('11. in_progress → in_progress → open', () => {
    expect(computeCanonicalCellState('in_progress', 'in_progress')).toBe<CanonicalCellState>('open')
  })

  it('12. planned → in_progress → open', () => {
    expect(computeCanonicalCellState('planned', 'in_progress')).toBe<CanonicalCellState>('open')
  })
})

// ─── Section 2 : computeCanonicalTransition ──────────────────────────────────

describe('computeCanonicalTransition', () => {
  it('1. null from → appeared', () => {
    expect(computeCanonicalTransition(null, 'open')).toBe<CanonicalTransition>('appeared')
  })

  it('2. null to → notMentioned (invariant : absence ≠ résolution)', () => {
    expect(computeCanonicalTransition('open', null)).toBe<CanonicalTransition>('notMentioned')
  })

  it('3. done → absent → notMentioned (done non inféré comme résolu)', () => {
    expect(computeCanonicalTransition('done', null)).toBe<CanonicalTransition>('notMentioned')
  })

  it('4. any → cancelled → cancelled', () => {
    expect(computeCanonicalTransition('open', 'cancelled')).toBe<CanonicalTransition>('cancelled')
    expect(computeCanonicalTransition('done', 'cancelled')).toBe<CanonicalTransition>('cancelled')
  })

  it('5. open → done → resolved', () => {
    expect(computeCanonicalTransition('open', 'done')).toBe<CanonicalTransition>('resolved')
  })

  it('6. non_compliant → done → resolved', () => {
    expect(computeCanonicalTransition('non_compliant', 'done')).toBe<CanonicalTransition>('resolved')
  })

  it('7. open → informational → resolved', () => {
    expect(computeCanonicalTransition('open', 'informational')).toBe<CanonicalTransition>('resolved')
  })

  it('8. done → open → reopened', () => {
    expect(computeCanonicalTransition('done', 'open')).toBe<CanonicalTransition>('reopened')
  })

  it('9. informational → in_progress → reopened', () => {
    expect(computeCanonicalTransition('informational', 'in_progress')).toBe<CanonicalTransition>('reopened')
  })

  it('10. open → non_compliant → aggravated', () => {
    expect(computeCanonicalTransition('open', 'non_compliant')).toBe<CanonicalTransition>('aggravated')
  })

  it('11. planned → in_progress → progressed', () => {
    expect(computeCanonicalTransition('planned', 'in_progress')).toBe<CanonicalTransition>('progressed')
  })

  it('12. open → open → stillOpen', () => {
    expect(computeCanonicalTransition('open', 'open')).toBe<CanonicalTransition>('stillOpen')
  })

  it('13. non_compliant → in_progress → stillOpen', () => {
    expect(computeCanonicalTransition('non_compliant', 'in_progress')).toBe<CanonicalTransition>('stillOpen')
  })
})

// ─── Section 3 : getCanonicalDelta (intégration mock Supabase) ───────────────

type PropRow = {
  subject_thread_id: string
  proposal_family: string
  thematic_category: string | null
  label: string
  document_status: string | null
}

type StiRow = {
  subject_thread_id: string
  canonical_subject_id: string
}

function makePropQuery(data: PropRow[]) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        not: vi.fn().mockResolvedValue({ data, error: null }),
      }),
    }),
  }
}

function makeStiQuery(data: StiRow[]) {
  return {
    select: vi.fn().mockReturnValue({
      in: vi.fn().mockResolvedValue({ data, error: null }),
    }),
  }
}

describe('getCanonicalDelta', () => {
  beforeEach(() => vi.clearAllMocks())

  it('20. deux threads du même canonical → un seul item agrégé', async () => {
    const fromRows: PropRow[] = [
      { subject_thread_id: 'th-A1', proposal_family: 'observation', thematic_category: null, label: 'Fissure', document_status: 'open' },
      { subject_thread_id: 'th-A2', proposal_family: 'reservation', thematic_category: null, label: 'Fissure v2', document_status: 'in_progress' },
    ]
    const toRows: PropRow[] = [
      { subject_thread_id: 'th-A1', proposal_family: 'observation', thematic_category: null, label: 'Fissure', document_status: 'done' },
      { subject_thread_id: 'th-A2', proposal_family: 'reservation', thematic_category: null, label: 'Fissure v2', document_status: 'open' },
    ]
    const stiRows: StiRow[] = [
      { subject_thread_id: 'th-A1', canonical_subject_id: 'cs-A' },
      { subject_thread_id: 'th-A2', canonical_subject_id: 'cs-A' },
    ]

    let call = 0
    mocks.from.mockImplementation((table: string) => {
      if (table === 'document_extraction_proposal') {
        return makePropQuery(call++ === 0 ? fromRows : toRows)
      }
      return makeStiQuery(stiRows)
    })

    const delta = await getCanonicalDelta('run-from', 'run-to')

    // Un seul canonical
    expect(delta.items).toHaveLength(1)
    expect(delta.items[0].canonicalSubjectId).toBe('cs-A')

    // from: worst(open, in_progress) = open  →  to: worst(done, open) = open
    // open → open = stillOpen
    expect(delta.items[0].fromStatus).toBe('open')
    expect(delta.items[0].toStatus).toBe('open')
    expect(delta.items[0].transition).toBe('stillOpen')
  })

  it('21. canonicals distincts restent distincts', async () => {
    const fromRows: PropRow[] = [
      { subject_thread_id: 'th-B', proposal_family: 'action', thematic_category: null, label: 'Tâche B', document_status: 'planned' },
    ]
    const toRows: PropRow[] = [
      { subject_thread_id: 'th-B', proposal_family: 'action', thematic_category: null, label: 'Tâche B', document_status: 'done' },
      { subject_thread_id: 'th-C', proposal_family: 'observation', thematic_category: null, label: 'Défaut C', document_status: 'open' },
    ]
    const stiRows: StiRow[] = [
      { subject_thread_id: 'th-B', canonical_subject_id: 'cs-B' },
      { subject_thread_id: 'th-C', canonical_subject_id: 'cs-C' },
    ]

    let call = 0
    mocks.from.mockImplementation((table: string) => {
      if (table === 'document_extraction_proposal') {
        return makePropQuery(call++ === 0 ? fromRows : toRows)
      }
      return makeStiQuery(stiRows)
    })

    const delta = await getCanonicalDelta('run-from', 'run-to')

    expect(delta.items).toHaveLength(2)
    const itemB = delta.items.find((i) => i.canonicalSubjectId === 'cs-B')!
    const itemC = delta.items.find((i) => i.canonicalSubjectId === 'cs-C')!

    expect(itemB.transition).toBe('resolved')   // planned → done
    expect(itemC.transition).toBe('appeared')   // absent → open
  })

  it('22. thread sans canonical_subject_id → ignoré', async () => {
    const fromRows: PropRow[] = [
      { subject_thread_id: 'th-no-cs', proposal_family: 'observation', thematic_category: null, label: 'Orphelin', document_status: 'open' },
    ]
    const toRows: PropRow[] = []
    const stiRows: StiRow[] = [] // pas de mapping

    let call = 0
    mocks.from.mockImplementation((table: string) => {
      if (table === 'document_extraction_proposal') {
        return makePropQuery(call++ === 0 ? fromRows : toRows)
      }
      return makeStiQuery(stiRows)
    })

    const delta = await getCanonicalDelta('run-from', 'run-to')
    expect(delta.items).toHaveLength(0)
  })

  it('23. canonical dont toutes les familles sont exclues → exclu du delta', async () => {
    const fromRows: PropRow[] = [
      { subject_thread_id: 'th-P', proposal_family: 'person', thematic_category: null, label: 'Jean Dupont', document_status: 'open' },
    ]
    const toRows: PropRow[] = [
      { subject_thread_id: 'th-P', proposal_family: 'person', thematic_category: null, label: 'Jean Dupont', document_status: 'open' },
    ]
    const stiRows: StiRow[] = [
      { subject_thread_id: 'th-P', canonical_subject_id: 'cs-person' },
    ]

    let call = 0
    mocks.from.mockImplementation((table: string) => {
      if (table === 'document_extraction_proposal') {
        return makePropQuery(call++ === 0 ? fromRows : toRows)
      }
      return makeStiQuery(stiRows)
    })

    const delta = await getCanonicalDelta('run-from', 'run-to')
    expect(delta.items).toHaveLength(0)
  })

  it('24. transitions cohérentes avec computeCanonicalTransition (même runs → même résultat)', async () => {
    const fromRows: PropRow[] = [
      { subject_thread_id: 'th-D', proposal_family: 'observation', thematic_category: null, label: 'Problème D', document_status: 'open' },
    ]
    const toRows: PropRow[] = [
      { subject_thread_id: 'th-D', proposal_family: 'observation', thematic_category: null, label: 'Problème D', document_status: 'non_compliant' },
    ]
    const stiRows: StiRow[] = [
      { subject_thread_id: 'th-D', canonical_subject_id: 'cs-D' },
    ]

    let call = 0
    mocks.from.mockImplementation((table: string) => {
      if (table === 'document_extraction_proposal') {
        return makePropQuery(call++ === 0 ? fromRows : toRows)
      }
      return makeStiQuery(stiRows)
    })

    const delta = await getCanonicalDelta('run-from', 'run-to')
    expect(delta.items).toHaveLength(1)

    const item = delta.items[0]
    // La transition doit correspondre à computeCanonicalTransition(fromStatus, toStatus)
    expect(item.transition).toBe(computeCanonicalTransition(item.fromStatus, item.toStatus))
    expect(item.transition).toBe('aggravated')
  })
})
