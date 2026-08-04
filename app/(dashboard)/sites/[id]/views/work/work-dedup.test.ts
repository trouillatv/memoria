// Tests de la logique de déduplication par subject_thread_id
// Vérifie : 52 occurrences → 36 entrées, groupement correct, représentant choisi

import { describe, it, expect } from 'vitest'
import type { SiteActionRow } from '@/lib/db/site-actions'

// Copie locale de la fonction (isolée du composant React pour être testable sans DOM)
interface ThreadGroup {
  threadId: string | null
  representative: SiteActionRow
  count: number
  reportIds: string[]
}

function groupActionsByThread(actions: SiteActionRow[]): ThreadGroup[] {
  const threadMap = new Map<string, SiteActionRow[]>()
  const noThread: SiteActionRow[] = []

  for (const action of actions) {
    const t = action.subject_thread_id
    if (!t) { noThread.push(action); continue }
    if (!threadMap.has(t)) threadMap.set(t, [])
    threadMap.get(t)!.push(action)
  }

  const groups: ThreadGroup[] = []

  for (const [threadId, occurrences] of threadMap) {
    const sorted = [...occurrences].sort((a, b) => b.created_at.localeCompare(a.created_at))
    const reportIds = [...new Set(occurrences.map((a) => a.report_id).filter((r): r is string => !!r))]
    groups.push({ threadId, representative: sorted[0], count: occurrences.length, reportIds })
  }

  for (const action of noThread) {
    groups.push({ threadId: null, representative: action, count: 1, reportIds: action.report_id ? [action.report_id] : [] })
  }

  return groups
}

function makeAction(overrides: Partial<SiteActionRow> & { id: string }): SiteActionRow {
  return {
    title: 'Action',
    body: null,
    corps_etat: null,
    assigned_to: null,
    status: 'open',
    kind: 'one_shot',
    created_at: '2026-08-02T10:00:00Z',
    due_date: null,
    report_id: null,
    converted_to_type: null,
    converted_to_id: null,
    site_id: 'site-1',
    organizationId: 'org-1',
    site_name: 'Test',
    contract_id: null,
    contract_name: null,
    subject_id: null,
    last_progress_at: null,
    snooze_reason: null,
    snoozed_at: null,
    subject_thread_id: null,
    ...overrides,
  }
}

describe('groupActionsByThread', () => {
  it('1. action sans thread → groupe propre (count=1, threadId=null)', () => {
    const a = makeAction({ id: 'a1' })
    const groups = groupActionsByThread([a])
    expect(groups).toHaveLength(1)
    expect(groups[0].threadId).toBeNull()
    expect(groups[0].count).toBe(1)
    expect(groups[0].representative.id).toBe('a1')
  })

  it('2. 3 actions du même thread → 1 groupe, count=3', () => {
    const thread = 'th-abc'
    const a1 = makeAction({ id: 'a1', subject_thread_id: thread, created_at: '2026-08-01T10:00:00Z' })
    const a2 = makeAction({ id: 'a2', subject_thread_id: thread, created_at: '2026-08-02T10:00:00Z' })
    const a3 = makeAction({ id: 'a3', subject_thread_id: thread, created_at: '2026-08-03T10:00:00Z' })
    const groups = groupActionsByThread([a1, a2, a3])
    expect(groups).toHaveLength(1)
    expect(groups[0].count).toBe(3)
    expect(groups[0].threadId).toBe(thread)
  })

  it('3. représentant = action la plus récente du thread', () => {
    const thread = 'th-xyz'
    const a1 = makeAction({ id: 'oldest', subject_thread_id: thread, created_at: '2026-08-01T08:00:00Z' })
    const a2 = makeAction({ id: 'newest', subject_thread_id: thread, created_at: '2026-08-03T12:00:00Z' })
    const a3 = makeAction({ id: 'middle', subject_thread_id: thread, created_at: '2026-08-02T10:00:00Z' })
    const groups = groupActionsByThread([a1, a2, a3])
    expect(groups[0].representative.id).toBe('newest')
  })

  it('4. report_ids = union des report_id non-null du thread', () => {
    const thread = 'th-rep'
    const a1 = makeAction({ id: 'r1', subject_thread_id: thread, report_id: 'rep-A' })
    const a2 = makeAction({ id: 'r2', subject_thread_id: thread, report_id: 'rep-B' })
    const a3 = makeAction({ id: 'r3', subject_thread_id: thread, report_id: 'rep-A' }) // doublon
    const groups = groupActionsByThread([a1, a2, a3])
    expect(groups[0].reportIds).toHaveLength(2)
    expect(groups[0].reportIds).toContain('rep-A')
    expect(groups[0].reportIds).toContain('rep-B')
  })

  it('5. threads distincts restent distincts', () => {
    const a = makeAction({ id: 'a', subject_thread_id: 'th-1' })
    const b = makeAction({ id: 'b', subject_thread_id: 'th-2' })
    const c = makeAction({ id: 'c', subject_thread_id: 'th-3' })
    const groups = groupActionsByThread([a, b, c])
    expect(groups).toHaveLength(3)
    expect(groups.every(g => g.count === 1)).toBe(true)
  })

  it('6. 52 occurrences → 36 groupes (simulation pattern OCEF)', () => {
    // 4 threads × 3 occurrences + 8 threads × 2 occurrences + 24 threads × 1 = 12+16+24 = 52
    const actions: SiteActionRow[] = []
    for (let t = 0; t < 4; t++) {
      for (let i = 0; i < 3; i++) {
        actions.push(makeAction({ id: `t${t}-${i}`, subject_thread_id: `thread-triple-${t}` }))
      }
    }
    for (let t = 0; t < 8; t++) {
      for (let i = 0; i < 2; i++) {
        actions.push(makeAction({ id: `d${t}-${i}`, subject_thread_id: `thread-double-${t}` }))
      }
    }
    for (let t = 0; t < 24; t++) {
      actions.push(makeAction({ id: `u${t}`, subject_thread_id: `thread-unique-${t}` }))
    }
    expect(actions).toHaveLength(52)
    const groups = groupActionsByThread(actions)
    expect(groups).toHaveLength(36)
  })

  it('7. actions sans thread incluses individuellement', () => {
    const withThread = makeAction({ id: 'wt', subject_thread_id: 'th-A' })
    const noThread1 = makeAction({ id: 'n1' })
    const noThread2 = makeAction({ id: 'n2' })
    const groups = groupActionsByThread([withThread, noThread1, noThread2])
    expect(groups).toHaveLength(3)
    const noThreadGroups = groups.filter(g => g.threadId === null)
    expect(noThreadGroups).toHaveLength(2)
  })

  it('8. liste vide → 0 groupes', () => {
    expect(groupActionsByThread([])).toHaveLength(0)
  })
})
