import { describe, expect, it } from 'vitest'
import {
  buildOverviewAttention,
  selectPriorityActions,
  selectRecentChanges,
  selectNextEvent,
  getActionDueLabel,
  getActionDueTone,
  type OverviewActionInput,
  type OverviewChangeInput,
  type OverviewEventInput,
  type OverviewSignalInput,
} from '@/lib/chantier/overview-projections'

describe('chantier overview projections', () => {
  const today = '2026-07-13'

  it('prioritizes attention signals deterministically and caps at three', () => {
    const signals: OverviewSignalInput[] = [
      { id: 'near', kind: 'event_upcoming', title: 'Visite demain', detail: '14 juil.' },
      { id: 'old-reserve', kind: 'reserve_old', title: 'Reserve ancienne', detail: '45 j' },
      { id: 'late', kind: 'action_overdue', title: 'Action en retard', detail: '3 j' },
      { id: 'block', kind: 'blocage_active', title: "Blocage d'acces", detail: 'Zone nord' },
    ]

    expect(buildOverviewAttention(signals).map((s) => s.id)).toEqual(['block', 'late', 'old-reserve'])
  })

  it('returns the explicit empty message when no attention signal exists', () => {
    expect(buildOverviewAttention([])).toEqual([])
  })

  it('selects only priority actions and orders overdue before upcoming', () => {
    const actions: OverviewActionInput[] = [
      action({ id: 'later', title: 'Plus tard', dueDate: '2026-08-01' }),
      action({ id: 'old', title: 'Sans date ancienne', createdAt: '2026-06-01' }),
      action({ id: 'soon', title: 'Cette semaine', dueDate: '2026-07-15' }),
      action({ id: 'late', title: 'En retard', dueDate: '2026-07-10' }),
      action({ id: 'today', title: "Aujourd'hui", dueDate: '2026-07-13' }),
      action({ id: 'done', title: 'Terminee', status: 'done', dueDate: '2026-07-01' }),
    ]

    expect(selectPriorityActions(actions, { todayIso: today, limit: 4 }).map((a) => a.id))
      .toEqual(['late', 'today', 'soon', 'old'])
  })

  it('keeps only significant recent changes since the last visit', () => {
    const changes: OverviewChangeInput[] = [
      change({ id: 'note', kind: 'note_added' }),
      change({ id: 'done', kind: 'action_done', occurredAt: '2026-07-08T08:00:00.000Z' }),
      change({ id: 'reserve', kind: 'reserve_created', occurredAt: '2026-07-09T08:00:00.000Z' }),
      change({ id: 'doc', kind: 'important_document_added', occurredAt: '2026-07-10T08:00:00.000Z' }),
      change({ id: 'meeting', kind: 'meeting_held', occurredAt: '2026-07-11T08:00:00.000Z' }),
      change({ id: 'ignored', kind: 'minor_note' }),
    ]

    expect(selectRecentChanges(changes, { sinceIso: '2026-07-01T00:00:00.000Z', limit: 5 }).map((c) => c.id))
      .toEqual(['meeting', 'doc', 'reserve', 'done'])
  })

  it('selects the next planned event and ignores past events', () => {
    const events: OverviewEventInput[] = [
      { id: 'past', kind: 'meeting', title: 'Reunion passee', startsAt: '2026-07-10T08:00:00.000Z' },
      { id: 'visit', kind: 'visit', title: 'Visite', startsAt: '2026-07-13T14:00:00.000Z' },
      { id: 'meeting', kind: 'meeting', title: 'Reunion', startsAt: '2026-07-14T08:00:00.000Z' },
    ]

    expect(selectNextEvent(events, '2026-07-13T08:00:00.000Z')?.id).toBe('visit')
  })

  it('labels and colors action due dates from a supplied current day', () => {
    expect(getActionDueLabel(action({ status: 'planned' }), today)).toBe('Planifiée')
    expect(getActionDueTone(action({ status: 'planned' }), today)).toBe('blue')

    expect(getActionDueLabel(action({ dueDate: '2026-07-10' }), today)).toBe('En retard depuis le 10 juil.')
    expect(getActionDueTone(action({ dueDate: '2026-07-10' }), today)).toBe('red')

    expect(getActionDueLabel(action({ dueDate: '2026-07-13' }), today)).toBe("Aujourd'hui")
    expect(getActionDueTone(action({ dueDate: '2026-07-13' }), today)).toBe('orange')

    expect(getActionDueLabel(action({ dueDate: '2026-07-15' }), today)).toBe('Cette semaine')
    expect(getActionDueTone(action({ dueDate: '2026-07-15' }), today)).toBe('orange')
  })
})

function action(overrides: Partial<OverviewActionInput>): OverviewActionInput {
  return {
    id: overrides.id ?? 'a',
    title: overrides.title ?? 'Action',
    status: overrides.status ?? 'open',
    dueDate: overrides.dueDate ?? null,
    createdAt: overrides.createdAt ?? '2026-07-01T00:00:00.000Z',
    href: overrides.href ?? '/sites/site/actions/a',
  }
}

function change(overrides: Partial<OverviewChangeInput>): OverviewChangeInput {
  return {
    id: overrides.id ?? 'c',
    kind: overrides.kind ?? 'action_done',
    title: overrides.title ?? 'Changement',
    occurredAt: overrides.occurredAt ?? '2026-07-10T08:00:00.000Z',
    href: overrides.href ?? null,
  }
}
