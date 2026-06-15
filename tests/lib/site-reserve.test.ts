// Helpers PURS des réserves / levée de réserves (migration 110) — pas de DB.
// Doctrine VOCABULAIRE : 'lifted' s'affiche "Levée", jamais "résolu".

import { describe, it, expect } from 'vitest'
import {
  statusLabel,
  summarizeReserves,
  RESERVE_STATUS_META,
  type SiteReserve,
} from '@/lib/db/site-reserve'

function reserve(over: Partial<SiteReserve> = {}): SiteReserve {
  return {
    id: 'r1',
    siteId: 's1',
    label: 'Fissure mur axe 4',
    location: null,
    issuedBy: null,
    issuedOn: null,
    status: 'open',
    photoBeforePath: null,
    photoAfterPath: null,
    liftedAt: null,
    liftNote: null,
    createdAt: '2026-06-15T00:00:00.000Z',
    ...over,
  }
}

describe('statusLabel — vocabulaire juridique', () => {
  it('open → "Ouverte"', () => {
    expect(statusLabel('open')).toBe('Ouverte')
  })

  it('lifted → "Levée" (jamais "résolu")', () => {
    expect(statusLabel('lifted')).toBe('Levée')
  })

  it('n’emploie jamais le terme "résolu"', () => {
    for (const meta of Object.values(RESERVE_STATUS_META)) {
      expect(meta.label.toLowerCase()).not.toContain('résolu')
    }
  })
})

describe('summarizeReserves — comptage open / lifted', () => {
  it('liste vide → {open:0, lifted:0}', () => {
    expect(summarizeReserves([])).toEqual({ open: 0, lifted: 0 })
  })

  it('compte séparément ouvertes et levées', () => {
    const reserves = [
      reserve({ id: 'a', status: 'open' }),
      reserve({ id: 'b', status: 'open' }),
      reserve({ id: 'c', status: 'lifted' }),
    ]
    expect(summarizeReserves(reserves)).toEqual({ open: 2, lifted: 1 })
  })

  it('toutes levées → open:0', () => {
    const reserves = [
      reserve({ id: 'a', status: 'lifted' }),
      reserve({ id: 'b', status: 'lifted' }),
    ]
    expect(summarizeReserves(reserves)).toEqual({ open: 0, lifted: 2 })
  })
})
