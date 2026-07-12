// « Tu dois faire » — quelle action mérite l'œil aujourd'hui ? (audit 2026-07-12)
// UN SEUL modèle, celui de /m/actions : retard 🔴 · aujourd'hui 🟠 · suivi =
// silence sauf décrochage 🟠 · reportée = silence sauf retard d'échéance 🟠.

import { describe, it, expect } from 'vitest'
import { actionAttentionOf } from '@/lib/actions/health'

const TODAY = '2026-07-12'

function action(over: Partial<Parameters<typeof actionAttentionOf>[0]> = {}) {
  return {
    due_date: null,
    created_at: '2026-07-10T20:00:00+11:00',
    last_progress_at: null,
    snooze_reason: null,
    ...over,
  }
}

describe('actionAttentionOf', () => {
  it('échéance dépassée → rouge, avec le retard nommé', () => {
    expect(actionAttentionOf(action({ due_date: '2026-07-09' }), TODAY)).toEqual({
      severity: 'red',
      note: 'en retard de 3 j',
    })
  })

  it("échéance aujourd'hui → orange", () => {
    expect(actionAttentionOf(action({ due_date: '2026-07-12' }), TODAY)).toEqual({
      severity: 'orange',
      note: "à faire aujourd'hui",
    })
  })

  it('échéance future → silence (le rythme normal)', () => {
    expect(actionAttentionOf(action({ due_date: '2026-07-15' }), TODAY)).toBeNull()
  })

  it("une routine EN SUIVI vivante ne hurle plus : suivie il y a 2 j → silence", () => {
    expect(
      actionAttentionOf(
        action({ created_at: '2026-05-01T09:00:00+11:00', last_progress_at: '2026-07-10T17:00:00+11:00' }),
        TODAY,
      ),
    ).toBeNull()
  })

  it("une routine VIEILLE mais suivie hier reste silencieuse (l'âge n'est pas une pathologie)", () => {
    expect(
      actionAttentionOf(
        action({ created_at: '2026-01-15T09:00:00+11:00', last_progress_at: '2026-07-11T17:00:00+11:00' }),
        TODAY,
      ),
    ).toBeNull()
  })

  it('suivi DÉCROCHÉ (aucune avancée depuis ≥ 7 j) → orange, jamais rouge', () => {
    const r = actionAttentionOf(
      action({ created_at: '2026-05-01T09:00:00+11:00', last_progress_at: '2026-07-03T17:00:00+11:00' }),
      TODAY,
    )
    expect(r).toEqual({ severity: 'orange', note: "en suivi · pas d'avancée depuis 9 j" })
  })

  it('jamais suivie et créée il y a ≥ 7 j → décrochage compté depuis la création', () => {
    const r = actionAttentionOf(action({ created_at: '2026-07-01T09:00:00+11:00' }), TODAY)
    expect(r?.severity).toBe('orange')
    expect(r?.note).toContain("pas d'avancée depuis 11 j")
  })

  it("avancée déclarée AUJOURD'HUI → silence, même en retard d'échéance", () => {
    expect(
      actionAttentionOf(
        action({ due_date: '2026-07-09', last_progress_at: '2026-07-12T08:00:00+11:00' }),
        TODAY,
      ),
    ).toBeNull()
  })

  it('reportée avec motif (sans retard) → silence : le report est un choix posé', () => {
    expect(
      actionAttentionOf(
        action({ snooze_reason: 'attente_client', created_at: '2026-04-01T09:00:00+11:00' }),
        TODAY,
      ),
    ).toBeNull()
  })

  it("reportée MAIS échéance dépassée → orange (visible, sans hurler)", () => {
    expect(
      actionAttentionOf(action({ snooze_reason: 'meteo', due_date: '2026-07-10' }), TODAY),
    ).toEqual({ severity: 'orange', note: 'reportée · en retard de 2 j' })
  })
})
