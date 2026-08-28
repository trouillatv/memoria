import { describe, it, expect } from 'vitest'
import { classifyActionUrgency, isActionOverdue } from './overdue-action'

const TODAY = '2026-08-28'

describe('classifyActionUrgency — source unique du « retard »', () => {
  it('sans date → undated', () => {
    expect(classifyActionUrgency(null, 'explicit', TODAY)).toBe('undated')
  })
  it('échéance passée CONFIRMÉE → late', () => {
    expect(classifyActionUrgency('2026-08-20', 'explicit', TODAY)).toBe('late')
  })
  it('échéance passée NON confirmée (estimated/null) → late_unconfirmed, jamais late', () => {
    expect(classifyActionUrgency('2026-08-20', 'estimated', TODAY)).toBe('late_unconfirmed')
    expect(classifyActionUrgency('2026-08-20', null, TODAY)).toBe('late_unconfirmed')
  })
  it("aujourd'hui / cette semaine / plus tard", () => {
    expect(classifyActionUrgency('2026-08-28', 'explicit', TODAY)).toBe('today')
    expect(classifyActionUrgency('2026-09-02', 'explicit', TODAY)).toBe('week')
    expect(classifyActionUrgency('2026-10-15', 'explicit', TODAY)).toBe('later')
  })
})

describe('isActionOverdue — compteur « en retard » canonique', () => {
  it('open + explicite + passée = en retard', () => {
    expect(isActionOverdue('open', '2026-08-20', 'explicit', TODAY)).toBe(true)
  })
  it('planned = jamais en retard (prise en charge explicite)', () => {
    expect(isActionOverdue('planned', '2026-08-20', 'explicit', TODAY)).toBe(false)
  })
  it('date non confirmée = jamais en retard', () => {
    expect(isActionOverdue('open', '2026-08-20', 'estimated', TODAY)).toBe(false)
    expect(isActionOverdue('open', '2026-08-20', null, TODAY)).toBe(false)
  })
  it('échéance future = pas en retard', () => {
    expect(isActionOverdue('open', '2026-09-10', 'explicit', TODAY)).toBe(false)
  })
})
