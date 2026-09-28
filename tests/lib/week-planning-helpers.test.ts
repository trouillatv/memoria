import { afterEach, describe, expect, it, vi } from 'vitest'
import { getWeekRange, todayNoumeaIso } from '@/lib/week-planning-helpers'

// ── SITE-PLAN-PROJ-1 (3e recette Vincent) — SEMAINE PAR DÉFAUT ANCRÉE NOUMEA ──
// L'Agenda chantier calculait sa semaine par défaut depuis `new Date()`, donc
// l'horloge du serveur (UTC sur Vercel). À 09h locales à Nouméa (UTC+11), le
// serveur est encore la veille en UTC : la semaine résolue était la précédente.
// Térmoin exact de Vincent : « le 28/09/2026 09:00 Nouméa doit afficher
// semaine 40, 28 sept. → 4 oct. »
describe('todayNoumeaIso — ancrage Pacific/Noumea, jamais l’horloge serveur', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('le 28/09/2026 09:00 Nouméa doit afficher semaine 40, 28 sept. → 4 oct.', () => {
    // 2026-09-27T22:00:00.000Z == 2026-09-28T09:00:00+11:00 (Nouméa) : encore
    // le 27 en UTC, déjà le 28 à Nouméa.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-27T22:00:00.000Z'))

    expect(todayNoumeaIso()).toBe('2026-09-28')

    const week = getWeekRange(todayNoumeaIso())
    expect(week.weekNumber).toBe(40)
    expect(week.year).toBe(2026)
    expect(week.weekStart).toBe('2026-09-28')
    expect(week.weekEnd).toBe('2026-10-04')
  })

  it('sans ancrage timezone, l’horloge serveur (UTC) résoudrait la mauvaise semaine', () => {
    // Preuve du bug : la même instant UTC, interprété brut sans fuseau,
    // reste le 27 (semaine 39) — c'est exactement l'écart corrigé.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-27T22:00:00.000Z'))

    const uncorrected = getWeekRange(new Date())
    expect(uncorrected.weekNumber).toBe(39)

    const corrected = getWeekRange(todayNoumeaIso())
    expect(corrected.weekNumber).toBe(40)
  })
})
