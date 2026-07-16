import { describe, expect, it } from 'vitest'
import { frDayMonthTimeLocal, frDayMonthPaddedLocal } from '@/lib/time/local-date'

// ── DOCTRINE : l'heure du conducteur, jamais celle du serveur ────────────────
// Vercel tourne en UTC. Un rendu serveur sans fuseau explicite affiche l'heure
// UTC : une visite de 11:57 à Nouméa se raconte « 00:57 ». Le piège est qu'une
// heure fausse reste PLAUSIBLE — elle ne lève aucune alerte, elle réécrit
// simplement l'histoire du chantier (constaté sur la chronologie, 2026-07-16).
//
// Ces tests fixent le comportement sur un instant réel : le rapport de visite
// DISCOUNT du 13 juillet, créé à 00:57:11 UTC = 11:57 à Nouméa.

const VISIT_DISCOUNT = '2026-07-13T00:57:11.369Z'

describe('Libellés de temps — zone Nouméa', () => {
  it("affiche l'heure de Nouméa, pas celle du serveur", () => {
    expect(frDayMonthTimeLocal(VISIT_DISCOUNT)).toBe('13 juillet à 11:57')
  })

  it('ne recule pas la date quand UTC est encore la veille', () => {
    // 15 juillet 09:00 à Nouméa = 14 juillet 22:00 UTC : la date civile doit
    // rester le 15 — sinon la visite du matin s'affiche « hier ».
    expect(frDayMonthPaddedLocal('2026-07-14T22:00:00.000Z')).toBe('15 juillet')
  })

  it('reste stable quel que soit le fuseau du processus', () => {
    const before = process.env.TZ
    try {
      process.env.TZ = 'UTC'
      expect(frDayMonthTimeLocal(VISIT_DISCOUNT)).toBe('13 juillet à 11:57')
      process.env.TZ = 'America/New_York'
      expect(frDayMonthTimeLocal(VISIT_DISCOUNT)).toBe('13 juillet à 11:57')
    } finally {
      process.env.TZ = before
    }
  })
})
