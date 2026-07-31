// Lot 2 — Tests du moteur de comparaison inter-CR
//
// Couvre :
//   - computeTransition (pure, 12 cas)
//   - getPvDelta (intégration avec mock Supabase, 4 cas)

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { computeTransition, getPvDelta } from './pv-comparison'
import type { DeltaTransition } from './pv-comparison'

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: mocks.from }),
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────

type Row = {
  id: string
  subject_thread_id: string
  proposal_family: string
  thematic_category: string | null
  label: string
  document_status: string | null
}

function row(overrides: Partial<Row> & { id: string; subject_thread_id: string }): Row {
  return {
    proposal_family: 'observation',
    thematic_category: null,
    label: 'Fissure façade',
    document_status: 'open',
    ...overrides,
  }
}

function makeFrom(
  from: { document_status: string | null; proposal_family?: string } | null,
  to: { document_status: string | null; proposal_family?: string } | null,
): Parameters<typeof computeTransition> {
  const base = { id: 'x', subject_thread_id: 't', thematic_category: null, label: 'L' }
  const f = from ? { ...base, proposal_family: from.proposal_family ?? 'observation', document_status: from.document_status } : null
  const t = to ? { ...base, proposal_family: to.proposal_family ?? 'observation', document_status: to.document_status } : null
  return [f, t]
}

// ─── Section 1 : computeTransition ────────────────────────────────────────────

describe('computeTransition', () => {
  it('1. null from → nouveau', () => {
    const [f, t] = makeFrom(null, { document_status: 'open' })
    expect(computeTransition(f, t)).toBe<DeltaTransition>('nouveau')
  })

  it('2. null to → non_mentionné', () => {
    const [f, t] = makeFrom({ document_status: 'open' }, null)
    expect(computeTransition(f, t)).toBe<DeltaTransition>('non_mentionné')
  })

  it('3. open → done (observation) → levé', () => {
    const [f, t] = makeFrom({ document_status: 'open', proposal_family: 'observation' }, { document_status: 'done' })
    expect(computeTransition(f, t)).toBe<DeltaTransition>('levé')
  })

  it('4. open → done (reservation) → levé', () => {
    const [f, t] = makeFrom({ document_status: 'open', proposal_family: 'reservation' }, { document_status: 'done' })
    expect(computeTransition(f, t)).toBe<DeltaTransition>('levé')
  })

  it('5. planned → done (action) → réalisé', () => {
    const [f, t] = makeFrom({ document_status: 'planned', proposal_family: 'action' }, { document_status: 'done' })
    expect(computeTransition(f, t)).toBe<DeltaTransition>('réalisé')
  })

  it('6. in_progress → done (knowledge_fact) → réalisé', () => {
    const [f, t] = makeFrom({ document_status: 'in_progress', proposal_family: 'knowledge_fact' }, { document_status: 'done' })
    expect(computeTransition(f, t)).toBe<DeltaTransition>('réalisé')
  })

  it('7. done → open → réouvert', () => {
    const [f, t] = makeFrom({ document_status: 'done' }, { document_status: 'open' })
    expect(computeTransition(f, t)).toBe<DeltaTransition>('réouvert')
  })

  it('8. done → in_progress → réouvert', () => {
    const [f, t] = makeFrom({ document_status: 'done' }, { document_status: 'in_progress' })
    expect(computeTransition(f, t)).toBe<DeltaTransition>('réouvert')
  })

  it('9. open → non_compliant → aggravé', () => {
    const [f, t] = makeFrom({ document_status: 'open' }, { document_status: 'non_compliant' })
    expect(computeTransition(f, t)).toBe<DeltaTransition>('aggravé')
  })

  it('10. in_progress → non_compliant → aggravé', () => {
    const [f, t] = makeFrom({ document_status: 'in_progress' }, { document_status: 'non_compliant' })
    expect(computeTransition(f, t)).toBe<DeltaTransition>('aggravé')
  })

  it('11. planned → in_progress → progressé', () => {
    const [f, t] = makeFrom({ document_status: 'planned' }, { document_status: 'in_progress' })
    expect(computeTransition(f, t)).toBe<DeltaTransition>('progressé')
  })

  it('12. open → open → maintenu', () => {
    const [f, t] = makeFrom({ document_status: 'open' }, { document_status: 'open' })
    expect(computeTransition(f, t)).toBe<DeltaTransition>('maintenu')
  })

  it('13. any → cancelled → annulé', () => {
    const [f, t] = makeFrom({ document_status: 'in_progress' }, { document_status: 'cancelled' })
    expect(computeTransition(f, t)).toBe<DeltaTransition>('annulé')
  })

  it('14. open → in_progress → changé (ni aggravé ni progressé)', () => {
    const [f, t] = makeFrom({ document_status: 'open' }, { document_status: 'in_progress' })
    expect(computeTransition(f, t)).toBe<DeltaTransition>('changé')
  })

  it('15. non_mentionné ne peut jamais être inféré comme levé (done → absent = réouvert impossible)', () => {
    // Un sujet done dans from, absent de to → non_mentionné (pas "resté levé")
    const [f, t] = makeFrom({ document_status: 'done' }, null)
    expect(computeTransition(f, t)).toBe<DeltaTransition>('non_mentionné')
  })
})

// ─── Section 2 : getPvDelta (intégration mock Supabase) ──────────────────────

function buildQueryMock(data: Row[]) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        not: vi.fn().mockResolvedValue({ data, error: null }),
      }),
    }),
  }
}

describe('getPvDelta', () => {
  beforeEach(() => vi.clearAllMocks())

  it('16. deux runs avec sujets communs → transitions correctes', async () => {
    const threadA = 'thread-a'
    const threadB = 'thread-b'

    const fromData: Row[] = [
      row({ id: 'p1', subject_thread_id: threadA, document_status: 'open', proposal_family: 'observation' }),
      row({ id: 'p2', subject_thread_id: threadB, document_status: 'planned', proposal_family: 'action' }),
    ]
    const toData: Row[] = [
      row({ id: 'p3', subject_thread_id: threadA, document_status: 'done', proposal_family: 'observation', label: 'Fissure corrigée' }),
      row({ id: 'p4', subject_thread_id: threadB, document_status: 'done', proposal_family: 'action' }),
    ]

    let call = 0
    mocks.from.mockImplementation(() => {
      const data = call++ === 0 ? fromData : toData
      return buildQueryMock(data)
    })

    const delta = await getPvDelta('run-from', 'run-to')
    expect(delta.items).toHaveLength(2)

    const itemA = delta.items.find((i) => i.subjectThreadId === threadA)!
    expect(itemA.transition).toBe('levé')
    expect(itemA.label).toBe('Fissure corrigée') // label du run to

    const itemB = delta.items.find((i) => i.subjectThreadId === threadB)!
    expect(itemB.transition).toBe('réalisé')
  })

  it('17. sujet absent de to → non_mentionné (jamais levé)', async () => {
    const threadA = 'thread-a'

    mocks.from.mockImplementationOnce(() =>
      buildQueryMock([row({ id: 'p1', subject_thread_id: threadA, document_status: 'open' })])
    ).mockImplementationOnce(() =>
      buildQueryMock([])
    )

    const delta = await getPvDelta('run-from', 'run-to')
    expect(delta.items).toHaveLength(1)
    expect(delta.items[0].transition).toBe('non_mentionné')
    expect(delta.items[0].toProposalId).toBeNull()
  })

  it('18. sujet absent de from → nouveau', async () => {
    const threadA = 'thread-a'

    mocks.from.mockImplementationOnce(() =>
      buildQueryMock([])
    ).mockImplementationOnce(() =>
      buildQueryMock([row({ id: 'p1', subject_thread_id: threadA, document_status: 'open' })])
    )

    const delta = await getPvDelta('run-from', 'run-to')
    expect(delta.items).toHaveLength(1)
    expect(delta.items[0].transition).toBe('nouveau')
    expect(delta.items[0].fromProposalId).toBeNull()
  })

  it('19. deux runs sans sujet thread → delta vide', async () => {
    mocks.from.mockImplementation(() => buildQueryMock([]))

    const delta = await getPvDelta('run-from', 'run-to')
    expect(delta.items).toHaveLength(0)
  })
})
