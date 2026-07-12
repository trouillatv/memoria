// « Prochaine étape » — le tri pur des futurs du chantier : le plus proche
// d'abord, jamais plus de `max`, les dates invalides écartées, le « jour »
// toujours compté en calendrier Nouméa (UTC+11), jamais en blocs de 24 h.

import { describe, it, expect } from 'vitest'
import { pickNextSteps, inLabelOf } from '@/lib/db/site-next-steps'

// 2026-07-12 08:00 UTC = 2026-07-12 19:00 à Nouméa.
const NOW = new Date('2026-07-12T08:00:00Z').getTime()

function step(kind: 'reunion' | 'intervention' | 'echeance', at: string, label = 'x') {
  return { kind, at, label, href: '/x' }
}

describe('pickNextSteps', () => {
  it('trie par proximité : la réunion de mardi passe avant l’intervention de vendredi', () => {
    const out = pickNextSteps(
      [step('intervention', '2026-07-17T08:00:00Z'), step('reunion', '2026-07-14T22:00:00Z'), step('echeance', '2026-07-20T00:00:00Z')],
      NOW,
    )
    expect(out.map((s) => s.kind)).toEqual(['reunion', 'intervention', 'echeance'])
  })

  it('borne à max (3 par défaut) — une étape, pas un agenda', () => {
    const many = Array.from({ length: 6 }, (_, i) => step('echeance', `2026-07-${13 + i}T00:00:00Z`))
    expect(pickNextSteps(many, NOW)).toHaveLength(3)
  })

  it('écarte les dates invalides plutôt que de casser le récit', () => {
    const out = pickNextSteps([step('reunion', 'pas-une-date'), step('echeance', '2026-07-15T00:00:00Z')], NOW)
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('echeance')
  })

  it('rien à venir → rien (silence positif, la carte n’existe pas)', () => {
    expect(pickNextSteps([], NOW)).toEqual([])
  })

  it("une échéance due AUJOURD'HUI (Nouméa) reste visible toute la journée, minuit passé", () => {
    // Minuit Nouméa du 12 = 01:00 UTC — déjà passé à NOW (08:00 UTC), mais
    // le jour Nouméa est encore le 12 : elle doit rester.
    const out = pickNextSteps([step('echeance', '2026-07-12T00:00:00+11:00')], NOW)
    expect(out).toHaveLength(1)
  })

  it("une échéance d'HIER (Nouméa) est écartée", () => {
    expect(pickNextSteps([step('echeance', '2026-07-11T00:00:00+11:00')], NOW)).toEqual([])
  })
})

describe('inLabelOf — jours calendaires Nouméa, pas blocs de 24 h', () => {
  it("« demain » même à moins de 24 h : réunion demain 9h vue ce soir 19h", () => {
    // 2026-07-13 09:00 Nouméa = 2026-07-12 22:00 UTC (14 h après NOW).
    expect(inLabelOf('2026-07-12T22:00:00Z', NOW)).toBe('demain')
  })

  it("« aujourd'hui » pour une échéance du jour, même minuit passé", () => {
    expect(inLabelOf('2026-07-12T00:00:00+11:00', NOW)).toBe("aujourd'hui")
  })

  it('« dans N j » au-delà de demain', () => {
    // 2026-07-15 Nouméa, vu le 12 → dans 3 j.
    expect(inLabelOf('2026-07-15T00:00:00+11:00', NOW)).toBe('dans 3 j')
  })
})
