import { describe, expect, it } from 'vitest'
import { validatePlanningDates } from '@/lib/planning/planning-item-contract'

describe('contrat Planning V1-A', () => {
  it('représente les fixtures DOVANT sans les transformer en deadlines', () => {
    const fixtures = [
      { kind: 'task', start: '2026-08-17', end: null, precision: 'day' },
      { kind: 'task', start: '2026-09-21', end: '2026-10-04', precision: 'week' },
      { kind: 'milestone', start: '2026-09-28', end: null, precision: 'day' },
      { kind: 'milestone', start: '2027-09-28', end: null, precision: 'day' },
    ] as const
    for (const fixture of fixtures) {
      expect(['task', 'milestone']).toContain(fixture.kind)
      expect(validatePlanningDates({ plannedStart: fixture.start, plannedEnd: fixture.end, temporalPrecision: fixture.precision })).toEqual({ start: fixture.start, end: fixture.end })
    }
  })

  it('accepte jour, plage, semaine et temporalité inconnue', () => {
    expect(validatePlanningDates({ plannedStart: '2026-08-17', temporalPrecision: 'day' }).start).toBe('2026-08-17')
    expect(validatePlanningDates({ plannedStart: '2026-09-21', plannedEnd: '2026-10-04', temporalPrecision: 'range' }).end).toBe('2026-10-04')
    expect(validatePlanningDates({ plannedStart: '2026-09-21', temporalPrecision: 'week' }).start).toBe('2026-09-21')
    expect(validatePlanningDates({ temporalPrecision: 'unknown' })).toEqual({ start: null, end: null })
  })

  it('rejette une fin antérieure, une date non civile et une précision sans début', () => {
    expect(() => validatePlanningDates({ plannedStart: '2026-10-04', plannedEnd: '2026-09-21' })).toThrow()
    expect(() => validatePlanningDates({ plannedStart: '2026-09' })).toThrow()
    expect(() => validatePlanningDates({ temporalPrecision: 'week' })).toThrow()
  })
})
