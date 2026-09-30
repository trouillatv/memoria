// DOC-CONTRACT-OS-1B4-C1 (mandat §15) — empreinte d'état Planning, pure :
// indépendance de l'ordre des slots (tri canonique), sensibilité à tout
// changement de contenu métier, jamais basée sur updated_at.

import { describe, it, expect } from 'vitest'
import {
  buildCanonicalCycleState,
  computeCycleStateFingerprint,
  buildCanonicalSimpleTemplateState,
  computeSimpleTemplateStateFingerprint,
  type CanonicalCycleSlot,
} from '@/lib/planning/state-fingerprint'
import type { CycleSlot } from '@/lib/db/planning-cycles'

const cycleA: CycleSlot[] = [
  { weekIndex: 0, weekday: 1, teamId: 'team-a', state: 'work', startTime: '08:00', endTime: '12:00' },
  { weekIndex: 0, weekday: 2, teamId: 'team-b', state: 'rest', startTime: null, endTime: null },
]

function baseCycle(overrides: Partial<{ slots: CycleSlot[] }> = {}) {
  return {
    cycleLengthWeeks: 2,
    anchorDate: '2026-10-05',
    startsOn: '2026-10-05',
    endsOn: null,
    slots: overrides.slots ?? cycleA,
  }
}

describe('computeCycleStateFingerprint', () => {
  it("est indépendant de l'ordre des slots fournis", () => {
    const a = computeCycleStateFingerprint(buildCanonicalCycleState(baseCycle()))
    const reversed = computeCycleStateFingerprint(
      buildCanonicalCycleState(baseCycle({ slots: [...cycleA].reverse() })),
    )
    expect(reversed).toBe(a)
  })

  it('est déterministe pour le même contenu', () => {
    const a = computeCycleStateFingerprint(buildCanonicalCycleState(baseCycle()))
    const b = computeCycleStateFingerprint(buildCanonicalCycleState(baseCycle()))
    expect(b).toBe(a)
  })

  it("change si le contenu d'un slot change (ex. horaire)", () => {
    const a = computeCycleStateFingerprint(buildCanonicalCycleState(baseCycle()))
    const changed: CycleSlot[] = [
      { ...cycleA[0], startTime: '09:00' },
      cycleA[1],
    ]
    const b = computeCycleStateFingerprint(buildCanonicalCycleState(baseCycle({ slots: changed })))
    expect(b).not.toBe(a)
  })

  it("change si un slot est ajouté ou retiré", () => {
    const a = computeCycleStateFingerprint(buildCanonicalCycleState(baseCycle()))
    const withExtra: CycleSlot[] = [
      ...cycleA,
      { weekIndex: 1, weekday: 3, teamId: 'team-c', state: 'work', startTime: '08:00', endTime: '12:00' },
    ]
    const b = computeCycleStateFingerprint(buildCanonicalCycleState(baseCycle({ slots: withExtra })))
    expect(b).not.toBe(a)
  })

  it('change si cycleLengthWeeks change (même grille)', () => {
    const a = computeCycleStateFingerprint(buildCanonicalCycleState(baseCycle()))
    const b = computeCycleStateFingerprint(
      buildCanonicalCycleState({ ...baseCycle(), cycleLengthWeeks: 4 }),
    )
    expect(b).not.toBe(a)
  })

  it('un tri manuel identique (par construction) ne change pas le résultat', () => {
    const slot: CanonicalCycleSlot = {
      weekIndex: 0,
      weekday: 1,
      teamId: 'team-a',
      state: 'work',
      startTime: '08:00',
      endTime: '12:00',
    }
    const a = computeCycleStateFingerprint({
      cycleLengthWeeks: 1,
      anchorDate: '2026-10-05',
      startsOn: '2026-10-05',
      endsOn: null,
      slots: [slot],
    })
    const b = computeCycleStateFingerprint({
      cycleLengthWeeks: 1,
      anchorDate: '2026-10-05',
      startsOn: '2026-10-05',
      endsOn: null,
      slots: [{ ...slot }],
    })
    expect(b).toBe(a)
  })
})

function baseSimpleTemplate(overrides: Partial<Parameters<typeof buildCanonicalSimpleTemplateState>[0]> = {}) {
  return {
    frequency: 'weekly',
    slots: ['morning', 'afternoon'],
    dayOfWeek: 1,
    dayOfMonth: null,
    plannedStartHHMM: '08:00',
    plannedEndHHMM: '10:00',
    startsOn: '2026-10-01',
    endsOn: null,
    ...overrides,
  }
}

describe('computeSimpleTemplateStateFingerprint', () => {
  it("est indépendant de l'ordre du tableau slots", () => {
    const a = computeSimpleTemplateStateFingerprint(buildCanonicalSimpleTemplateState(baseSimpleTemplate()))
    const b = computeSimpleTemplateStateFingerprint(
      buildCanonicalSimpleTemplateState(baseSimpleTemplate({ slots: ['afternoon', 'morning'] })),
    )
    expect(b).toBe(a)
  })

  it('est déterministe pour le même contenu', () => {
    const a = computeSimpleTemplateStateFingerprint(buildCanonicalSimpleTemplateState(baseSimpleTemplate()))
    const b = computeSimpleTemplateStateFingerprint(buildCanonicalSimpleTemplateState(baseSimpleTemplate()))
    expect(b).toBe(a)
  })

  it('change si dayOfWeek change', () => {
    const a = computeSimpleTemplateStateFingerprint(buildCanonicalSimpleTemplateState(baseSimpleTemplate()))
    const b = computeSimpleTemplateStateFingerprint(
      buildCanonicalSimpleTemplateState(baseSimpleTemplate({ dayOfWeek: 2 })),
    )
    expect(b).not.toBe(a)
  })

  it("change si l'heure planifiée change", () => {
    const a = computeSimpleTemplateStateFingerprint(buildCanonicalSimpleTemplateState(baseSimpleTemplate()))
    const b = computeSimpleTemplateStateFingerprint(
      buildCanonicalSimpleTemplateState(baseSimpleTemplate({ plannedStartHHMM: '09:00' })),
    )
    expect(b).not.toBe(a)
  })
})
