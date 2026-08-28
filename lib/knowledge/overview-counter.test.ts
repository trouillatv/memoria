import { describe, it, expect } from 'vitest'
import { sliceOverview, exactRemainder } from './overview-counter'

// #231 — l'invariant : total exhaustif, aperçu capé, « +N » exact. Ces tests
// verrouillent la disparition des DEUX défauts de Phase 1 (double troncature
// Attention « 2 pour 14 », et « proposées » annoncé mais tronqué en silence).

describe('sliceOverview', () => {
  it('cape l\'affichage mais garde le total réel (anti double-troncature)', () => {
    const all = Array.from({ length: 17 }, (_, i) => i) // cas OCEF : 17 sujets
    const r = sliceOverview(all, 3)
    expect(r.total).toBe(17)
    expect(r.shown).toEqual([0, 1, 2])
    expect(r.hiddenCount).toBe(14) // et NON 2
  })

  it('hiddenCount = 0 quand tout tient dans le cap', () => {
    const r = sliceOverview([1, 2], 3)
    expect(r.total).toBe(2)
    expect(r.shown).toEqual([1, 2])
    expect(r.hiddenCount).toBe(0)
  })

  it('total + shown + hidden restent cohérents (shown.length + hidden = total)', () => {
    const all = Array.from({ length: 9 }, (_, i) => i)
    const r = sliceOverview(all, 4)
    expect(r.shown.length + r.hiddenCount).toBe(r.total)
  })

  it('cap 0 = rien affiché, tout caché', () => {
    const r = sliceOverview([1, 2, 3], 0)
    expect(r.shown).toEqual([])
    expect(r.hiddenCount).toBe(3)
  })

  it('liste vide → total 0, aucun reste', () => {
    const r = sliceOverview([], 3)
    expect(r).toEqual({ total: 0, shown: [], hiddenCount: 0 })
  })
})

describe('exactRemainder', () => {
  it('reste = total − affichés (cas « 7 proposées », 3 montrées)', () => {
    expect(exactRemainder(7, 3)).toBe(4)
    expect(exactRemainder(15, 3)).toBe(12)
  })

  it('jamais négatif quand l\'échantillon couvre déjà tout', () => {
    expect(exactRemainder(2, 3)).toBe(0)
    expect(exactRemainder(0, 0)).toBe(0)
  })
})
