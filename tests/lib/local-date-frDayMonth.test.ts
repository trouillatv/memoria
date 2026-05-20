// Vérif que frDayMonthLocal applique bien Pacific/Noumea (UTC+11) et
// ne fuit pas sur la locale serveur (UTC en prod).
//
// Cas critique : un événement créé à 09h Nouméa = 22h UTC la veille.
// Sans timezone Nouméa, on afficherait un jour trop tôt.

import { describe, it, expect } from 'vitest'
import { frDayMonthLocal } from '@/lib/time/local-date'

describe('frDayMonthLocal — fuseau Pacific/Noumea (UTC+11)', () => {
  it('19 mai 00:00 UTC = 19 mai 11:00 Nouméa → "19 mai"', () => {
    expect(frDayMonthLocal('2026-05-19T00:00:00Z')).toBe('19 mai')
  })

  it('19 mai 22:00 UTC = 20 mai 09:00 Nouméa → "20 mai" (PAS "19 mai")', () => {
    // C'est LE cas du bug Vincent : sans timezone, on afficherait "19 mai".
    expect(frDayMonthLocal('2026-05-19T22:00:00Z')).toBe('20 mai')
  })

  it('19 mai 13:00 UTC = 20 mai 00:00 Nouméa → "20 mai"', () => {
    // Frontière exacte de minuit Nouméa.
    expect(frDayMonthLocal('2026-05-19T13:00:00Z')).toBe('20 mai')
  })

  it('20 mai 12:59 UTC = 20 mai 23:59 Nouméa → "20 mai" (toujours dans le jour)', () => {
    expect(frDayMonthLocal('2026-05-20T12:59:00Z')).toBe('20 mai')
  })

  it('20 mai 13:00 UTC = 21 mai 00:00 Nouméa → "21 mai" (passage du jour)', () => {
    expect(frDayMonthLocal('2026-05-20T13:00:00Z')).toBe('21 mai')
  })

  it('accepte un objet Date directement', () => {
    expect(frDayMonthLocal(new Date('2026-05-19T22:00:00Z'))).toBe('20 mai')
  })

  it('ISO invalide → fallback non-cassant (slice 10 chars)', () => {
    expect(frDayMonthLocal('not-an-iso-date')).toBe('not-an-iso')
  })
})

describe('frDayMonth (re-export depuis matchers) → identique', () => {
  it('frDayMonth importé via resonance-matchers est le même que frDayMonthLocal', async () => {
    const { frDayMonth } = await import('@/lib/documents/resonance-matchers')
    expect(frDayMonth('2026-05-19T22:00:00Z')).toBe('20 mai')
  })

  it('frDayMonth via cross-store-matchers (B2) est le même', async () => {
    const { frDayMonth } = await import('@/lib/documents/cross-store-matchers')
    expect(frDayMonth('2026-05-19T22:00:00Z')).toBe('20 mai')
  })
})
