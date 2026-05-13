// Tests unitaires sur les helpers purs de lib/db/sites.ts.
// Les fonctions DB (listSitesGlobal, getSiteDependencies, softDeleteSite,
// updateSite) nécessitent des fixtures Supabase, elles seront testées
// en intégration séparément.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isSiteInactive } from '@/lib/db/sites'

describe('isSiteInactive', () => {
  const FIXED_NOW = new Date('2026-05-13T12:00:00.000Z')

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(FIXED_NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('retourne false pour un site sans intervention (pas inactif)', () => {
    expect(isSiteInactive(null)).toBe(false)
  })

  it("retourne false pour une intervention d'il y a moins de 6 mois", () => {
    // 2025-12-15 = ~5 mois avant 2026-05-13
    expect(isSiteInactive('2025-12-15T08:00:00.000Z')).toBe(false)
  })

  it("retourne true pour une intervention d'il y a plus de 6 mois", () => {
    // 2025-10-01 = ~7 mois avant 2026-05-13
    expect(isSiteInactive('2025-10-01T08:00:00.000Z')).toBe(true)
  })

  it('frontière exactement 6 mois : pas inactif', () => {
    // 2025-11-13 = exactement 6 mois (même jour)
    expect(isSiteInactive('2025-11-13T12:00:00.000Z')).toBe(false)
  })

  it('frontière 6 mois - 1 jour : pas inactif', () => {
    expect(isSiteInactive('2025-11-14T12:00:00.000Z')).toBe(false)
  })
})
