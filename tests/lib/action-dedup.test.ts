// Convergence KPI : même read-model dédupliqué partout.
// Invariant : N lignes DB avec doublons → M sujets opérationnels (M < N),
// et ce nombre est identique entre Aperçu et page Actions.

import { describe, it, expect } from 'vitest'
import { deduplicateByThread, type ActionSummaryRow } from '@/lib/knowledge/repository'

function makeRow(overrides: Partial<ActionSummaryRow> & { id: string }): ActionSummaryRow {
  return {
    title: 'Action',
    status: 'open',
    due_date: null,
    due_date_status: null,
    created_at: '2026-08-01T10:00:00Z',
    done_at: null,
    assigned_to: null,
    report_id: null,
    corps_etat: null,
    subject_thread_id: null,
    ...overrides,
  }
}

describe('deduplicateByThread', () => {
  it('sans thread : chaque ligne reste distincte', () => {
    const rows = [makeRow({ id: 'a1' }), makeRow({ id: 'a2' }), makeRow({ id: 'a3' })]
    expect(deduplicateByThread(rows)).toHaveLength(3)
  })

  it('même thread : une seule entrée (la plus récente)', () => {
    const rows = [
      makeRow({ id: 'old', subject_thread_id: 'th-1', created_at: '2026-08-01T08:00:00Z' }),
      makeRow({ id: 'new', subject_thread_id: 'th-1', created_at: '2026-08-03T12:00:00Z' }),
    ]
    const dedup = deduplicateByThread(rows)
    expect(dedup).toHaveLength(1)
    expect(dedup[0].id).toBe('new')
  })

  it('threads distincts restent distincts', () => {
    const rows = [
      makeRow({ id: 'a', subject_thread_id: 'th-1' }),
      makeRow({ id: 'b', subject_thread_id: 'th-2' }),
      makeRow({ id: 'c', subject_thread_id: 'th-3' }),
    ]
    expect(deduplicateByThread(rows)).toHaveLength(3)
  })

  it('OCEF Compostage pattern : 52 lignes → 36 sujets opérationnels', () => {
    // 4 threads × 3 + 8 threads × 2 + 24 threads × 1 = 52 lignes = 36 threads
    const rows: ActionSummaryRow[] = []
    for (let t = 0; t < 4; t++) {
      for (let i = 0; i < 3; i++) {
        rows.push(makeRow({ id: `t${t}-${i}`, subject_thread_id: `thread-triple-${t}`, created_at: `2026-08-0${i + 1}T10:00:00Z` }))
      }
    }
    for (let t = 0; t < 8; t++) {
      for (let i = 0; i < 2; i++) {
        rows.push(makeRow({ id: `d${t}-${i}`, subject_thread_id: `thread-double-${t}`, created_at: `2026-08-0${i + 1}T10:00:00Z` }))
      }
    }
    for (let t = 0; t < 24; t++) {
      rows.push(makeRow({ id: `u${t}`, subject_thread_id: `thread-unique-${t}` }))
    }

    expect(rows).toHaveLength(52)
    const dedup = deduplicateByThread(rows)
    expect(dedup).toHaveLength(36)

    // Convergence : Aperçu et /actions utilisent la même fonction → même total.
    const apercu_active = dedup.filter((a) => a.status === 'open' || a.status === 'planned').length
    const actions_total = deduplicateByThread(rows.filter((a) => a.status === 'open' || a.status === 'planned')).length
    expect(apercu_active).toBe(actions_total)
    expect(apercu_active).toBe(36)
  })

  it('liste vide → 0 entrées', () => {
    expect(deduplicateByThread([])).toHaveLength(0)
  })
})
