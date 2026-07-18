import { describe, expect, it } from 'vitest'
import {
  normalizeActionHistory, groupHistoryByDay, historyNoteFor,
  type RawActionEvent, type ActionEventKind,
} from '@/lib/knowledge/action-history'

const ev = (o: Partial<RawActionEvent> & { id: string; kind: ActionEventKind; occurred_at: string }): RawActionEvent => ({
  actor_label: null, before_value: null, after_value: null, reason: null, ...o,
})

describe('normalizeActionHistory — la chronologie ne raconte que les faits journalisés', () => {
  it('trie chronologiquement, départage par id (déterministe)', () => {
    const out = normalizeActionHistory([
      ev({ id: 'b', kind: 'completed', occurred_at: '2026-07-19T05:00:00Z' }),
      ev({ id: 'a', kind: 'created', occurred_at: '2026-07-18T22:14:00Z' }),
      ev({ id: 'a2', kind: 'assigned', occurred_at: '2026-07-18T22:14:00Z', after_value: { label: 'X' } }),
    ])
    expect(out.map((e) => e.id)).toEqual(['a', 'a2', 'b'])
  })

  it('attribution : « Attribuée à <nom snapshot> », depuis after_value.label', () => {
    const [e] = normalizeActionHistory([ev({ id: '1', kind: 'assigned', occurred_at: '2026-07-18T00:00:00Z', after_value: { label: 'Vincent Milon' } })])
    expect(e.line).toBe('Attribuée à Vincent Milon')
  })

  it('dés-attribution : depuis before_value.label', () => {
    const [e] = normalizeActionHistory([ev({ id: '1', kind: 'unassigned', occurred_at: '2026-07-18T00:00:00Z', before_value: { label: 'Vincent Milon' } })])
    expect(e.line).toContain('Vincent Milon')
    expect(e.line).toMatch(/retirée/i)
  })

  it('échéance déplacée : before → after, dates civiles sans dérive TZ', () => {
    const [e] = normalizeActionHistory([ev({ id: '1', kind: 'due_date_changed', occurred_at: '2026-07-18T00:00:00Z', before_value: { date: '2026-07-22' }, after_value: { date: '2026-07-25' } })])
    expect(e.line).toBe('Échéance déplacée')
    expect(e.detail).toBe('22 juillet 2026 → 25 juillet 2026')
  })

  it('échéance fixée / retirée selon before/after null', () => {
    const fixed = normalizeActionHistory([ev({ id: '1', kind: 'due_date_changed', occurred_at: '2026-07-18T00:00:00Z', after_value: { date: '2026-08-01' } })])[0]
    expect(fixed.line).toBe('Échéance fixée')
    const removed = normalizeActionHistory([ev({ id: '1', kind: 'due_date_changed', occurred_at: '2026-07-18T00:00:00Z', before_value: { date: '2026-08-01' } })])[0]
    expect(removed.line).toBe('Échéance retirée')
  })

  it('acteur : nom si actor_label ; sinon « auto » pour created, « unknown » sinon', () => {
    const named = normalizeActionHistory([ev({ id: '1', kind: 'completed', occurred_at: '2026-07-18T00:00:00Z', actor_label: 'Guillaume Martin' })])[0]
    expect(named).toMatchObject({ actorLabel: 'Guillaume Martin', actorFallback: null })
    const created = normalizeActionHistory([ev({ id: '1', kind: 'created', occurred_at: '2026-07-18T00:00:00Z' })])[0]
    expect(created).toMatchObject({ actorLabel: null, actorFallback: 'auto' })
    const orphan = normalizeActionHistory([ev({ id: '1', kind: 'completed', occurred_at: '2026-07-18T00:00:00Z' })])[0]
    expect(orphan).toMatchObject({ actorLabel: null, actorFallback: 'unknown' })
  })

  it('completed PUIS reopened : les deux sont racontés, dans l’ordre', () => {
    const out = normalizeActionHistory([
      ev({ id: '1', kind: 'completed', occurred_at: '2026-07-19T04:41:00Z' }),
      ev({ id: '2', kind: 'reopened', occurred_at: '2026-07-19T21:12:00Z', reason: 'preuve insuffisante' }),
    ])
    expect(out.map((e) => e.kind)).toEqual(['completed', 'reopened'])
    expect(out[1].reason).toBe('preuve insuffisante')
  })
})

describe('groupHistoryByDay — regroupement par jour civil Nouméa, heures locales', () => {
  it('22:14 UTC → 19 juillet 09:14 (Nouméa +11)', () => {
    const days = groupHistoryByDay(normalizeActionHistory([ev({ id: '1', kind: 'created', occurred_at: '2026-07-18T22:14:00Z' })]))
    expect(days).toHaveLength(1)
    expect(days[0].dayLabel).toBe('19 juillet 2026')
    expect(days[0].items[0].time).toBe('09:14')
  })

  it('deux jours distincts → deux groupes ordonnés', () => {
    const days = groupHistoryByDay(normalizeActionHistory([
      ev({ id: '1', kind: 'created', occurred_at: '2026-07-18T00:00:00Z' }),
      ev({ id: '2', kind: 'completed', occurred_at: '2026-07-20T00:00:00Z' }),
    ]))
    expect(days.map((d) => d.dayIso)).toEqual(['2026-07-18', '2026-07-20'])
  })
})

describe('historyNoteFor — état honnête pour une action ancienne (backfill created seul)', () => {
  it('created seul → note « à partir du <jour réel> », jamais inventée', () => {
    const note = historyNoteFor(normalizeActionHistory([ev({ id: '1', kind: 'created', occurred_at: '2026-07-18T22:14:00Z' })]))
    expect(note).toBe('Historique détaillé disponible à partir du 19 juillet 2026.')
  })

  it('dès qu’un autre événement existe → pas de note', () => {
    const note = historyNoteFor(normalizeActionHistory([
      ev({ id: '1', kind: 'created', occurred_at: '2026-07-18T00:00:00Z' }),
      ev({ id: '2', kind: 'assigned', occurred_at: '2026-07-19T00:00:00Z', after_value: { label: 'X' } }),
    ]))
    expect(note).toBeNull()
  })

  it('journal vide → pas de note (mais impossible en prod grâce au backfill created)', () => {
    expect(historyNoteFor([])).toBeNull()
  })
})
