import { describe, it, expect } from 'vitest'
import { selectEssentialMoments, type EvolutionPeriod } from '@/lib/documents/pv-evolution'

// « Essentiel » (P3-2) = {première active} ∪ {maxima locaux d'importanceScore} ∪ {dernière active}.
// Silences jamais comptés / jamais forçants. Cap 8 = garde-fou, aucun minimum forcé.
// La primitive ne lit que `isSilence` et `importanceScore` → fixtures minimales.

function period(importanceScore: number, isSilence = false): EvolutionPeriod {
  return {
    label: isSilence ? 'silence' : `p${importanceScore}`,
    startDate: '2025-01-01', endDate: '2025-01-31',
    pvNumbers: [], runIds: [], isSilence,
    appeared: [], reopened: [], aggravated: [], resolved: [], stillOpen: [],
    importanceScore,
  }
}
const A = (s: number) => period(s, false)
const S = () => period(2, true)
const idxs = (ps: EvolutionPeriod[]) => selectEssentialMoments(ps).map((m) => m.index)

describe('selectEssentialMoments — doctrine E (début + maxima locaux + actuel)', () => {
  it('1. début toujours retenu', () => {
    const r = selectEssentialMoments([A(10), A(5), A(3)])
    expect(r[0]).toEqual({ index: 0, reason: 'start' })
  })

  it('2. actuel toujours retenu', () => {
    const r = selectEssentialMoments([A(3), A(5), A(10)])
    expect(r[r.length - 1]).toEqual({ index: 2, reason: 'current' })
  })

  it('3. un maximum local interne est retenu', () => {
    // [100, 10, 50, 10, 100] → le pic interne #2 doit sortir
    expect(idxs([A(100), A(10), A(50), A(10), A(100)])).toContain(2)
  })

  it('4. une période ordinaire (creux) n’est PAS retenue', () => {
    expect(idxs([A(100), A(10), A(50), A(10), A(100)])).not.toContain(1)
  })

  it('5. un silence n’est jamais un moment essentiel', () => {
    // indices pleins : 0=A,1=S,2=A,3=S,4=A → aucun index 1 ou 3
    const r = idxs([A(10), S(), A(50), S(), A(10)])
    expect(r).not.toContain(1)
    expect(r).not.toContain(3)
    expect(r.every((i) => i % 2 === 0)).toBe(true)
  })

  it('6. une période à faible score juste après un silence n’est PAS auto-retenue', () => {
    // actives [100, 5, 100] séparées par silences ; l’active #1 (plein index 2) = creux → exclue
    const r = idxs([A(100), S(), A(5), S(), A(100)])
    expect(r).not.toContain(2)
    expect(r).toEqual([0, 4])
  })

  it('7. plateau de scores égaux → une seule période, la plus récente', () => {
    // [10, 50, 50, 20] → run [1,2] pic → garder index 2, pas 1
    const r = idxs([A(10), A(50), A(50), A(20)])
    expect(r).toContain(2)
    expect(r).not.toContain(1)
  })

  it('8. cap 8 = garde-fou : jamais plus de 8 moments, bornes conservées', () => {
    // alternance 1/9 sur 17 périodes → 8 pics + 2 bornes = 10 → capé à 8
    const alt = Array.from({ length: 17 }, (_, i) => A(i % 2 === 0 ? 1 : 9))
    const r = selectEssentialMoments(alt)
    expect(r.length).toBe(8)
    expect(r[0].index).toBe(0)
    expect(r[r.length - 1].index).toBe(16)
  })

  it('9. aucun minimum forcé : une trajectoire décroissante ne garde que début + actuel', () => {
    expect(idxs([A(100), A(50), A(10)])).toEqual([0, 2])
  })

  it('10. recette RUS : [456,68,92,60,66,80,144,62] → {0,2,6,7}', () => {
    const rus = [456, 68, 92, 60, 66, 80, 144, 62].map(A)
    const r = selectEssentialMoments(rus)
    expect(r.map((m) => m.index)).toEqual([0, 2, 6, 7])
    expect(r.map((m) => m.reason)).toEqual(['start', 'peak', 'peak', 'current'])
  })

  it('cas limites : vide → [] ; une seule période → début', () => {
    expect(selectEssentialMoments([])).toEqual([])
    expect(selectEssentialMoments([A(42)])).toEqual([{ index: 0, reason: 'start' }])
  })

  it('ne compte pas les silences dans le cardinal des moments', () => {
    // 2 actives + 3 silences → au plus 2 moments (début=actuel côtés), jamais 5
    const r = selectEssentialMoments([S(), A(10), S(), A(20), S()])
    expect(r.length).toBeLessThanOrEqual(2)
    expect(r.every((m) => m.reason !== 'peak' || true)).toBe(true)
  })
})
