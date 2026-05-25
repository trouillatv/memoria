import { describe, it, expect } from 'vitest'
import { describeTemplate, formatDateFr, joinSlotsFr } from '@/lib/recurrence/describe'
import type { DbInterventionTemplate } from '@/types/db'

function makeTemplate(patch: Partial<DbInterventionTemplate>): DbInterventionTemplate {
  return {
    id: 'tpl-1',
    mission_id: 'm-1',
    title: 'Test',
    description: null,
    frequency: 'daily',
    slots: null,
    day_of_week: null,
    day_of_month: null,
    planned_start_hhmm: null,
    planned_end_hhmm: null,
    starts_on: '2026-05-11',
    ends_on: null,
    active: true,
    created_at: '2026-05-11T00:00:00.000Z',
    created_by: null,
    deleted_at: null,
    ...patch,
  }
}

describe('formatDateFr', () => {
  it('formats YYYY-MM-DD to French long form', () => {
    expect(formatDateFr('2026-05-11')).toBe('11 mai 2026')
    expect(formatDateFr('2026-01-01')).toBe('1 janvier 2026')
    expect(formatDateFr('2026-12-31')).toBe('31 décembre 2026')
  })

  it('returns input as-is for non-ISO date strings', () => {
    expect(formatDateFr('not-a-date')).toBe('not-a-date')
  })
})

describe('joinSlotsFr', () => {
  it('returns empty string for null/empty', () => {
    expect(joinSlotsFr(null)).toBe('')
    expect(joinSlotsFr([])).toBe('')
  })

  it('handles 1 slot', () => {
    expect(joinSlotsFr(['morning'])).toBe('matin')
    expect(joinSlotsFr(['afternoon'])).toBe('après-midi')
    expect(joinSlotsFr(['evening'])).toBe('soir')
  })

  it('handles 2 slots with "et"', () => {
    expect(joinSlotsFr(['morning', 'evening'])).toBe('matin et soir')
  })

  it('handles 3 slots with comma + "et"', () => {
    expect(joinSlotsFr(['morning', 'afternoon', 'evening'])).toBe('matin, après-midi et soir')
  })
})

describe('describeTemplate — 5 patterns', () => {
  it('daily + 2 slots', () => {
    const t = makeTemplate({ frequency: 'daily', slots: ['morning', 'evening'] })
    expect(describeTemplate(t)).toBe('Tous les jours, matin et soir, à partir du 11 mai 2026')
  })

  it('weekdays + 1 slot', () => {
    const t = makeTemplate({ frequency: 'weekdays', slots: ['morning'] })
    expect(describeTemplate(t)).toBe('Du lundi au vendredi, matin, à partir du 11 mai 2026')
  })

  it('weekly + day_of_week=2 + 1 slot', () => {
    const t = makeTemplate({ frequency: 'weekly', day_of_week: 2, slots: ['afternoon'] })
    expect(describeTemplate(t)).toBe('Tous les mardis, après-midi, à partir du 11 mai 2026')
  })

  it('weekly without day_of_week falls back to generic phrase', () => {
    const t = makeTemplate({ frequency: 'weekly', day_of_week: null, slots: null })
    expect(describeTemplate(t)).toBe('Une fois par semaine, à partir du 11 mai 2026')
  })

  it('monthly + day_of_month=15 + no slots', () => {
    const t = makeTemplate({ frequency: 'monthly', day_of_month: 15, slots: null })
    expect(describeTemplate(t)).toBe('Tous les 15 du mois, à partir du 11 mai 2026')
  })

  it('monthly day_of_month=1 uses "1er"', () => {
    const t = makeTemplate({ frequency: 'monthly', day_of_month: 1, slots: null })
    expect(describeTemplate(t)).toBe('Tous les 1er du mois, à partir du 11 mai 2026')
  })

  it('one_shot without slots', () => {
    const t = makeTemplate({ frequency: 'one_shot', slots: null, starts_on: '2026-05-11' })
    expect(describeTemplate(t)).toBe('Le 11 mai 2026')
  })

  it('one_shot with slots', () => {
    const t = makeTemplate({
      frequency: 'one_shot',
      slots: ['morning', 'afternoon', 'evening'],
      starts_on: '2026-05-11',
    })
    expect(describeTemplate(t)).toBe('Le 11 mai 2026, matin, après-midi et soir')
  })

  it('daily without slots omits slots clause', () => {
    const t = makeTemplate({ frequency: 'daily', slots: null })
    expect(describeTemplate(t)).toBe('Tous les jours, à partir du 11 mai 2026')
  })
})
