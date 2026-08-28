import { describe, it, expect } from 'vitest'
import { runTensionState, tensionTrajectory } from '@/lib/documents/subject-state'

// P0-1 — doctrine non-mention ≠ résolu : la tension ne baisse QUE sur résolution prouvée ;
// une non-mention reporte le dernier état prouvé (carry-forward).

describe('runTensionState', () => {
  it("'resolved' seulement si TOUS les états du PV sont prouvés résolus", () => {
    expect(runTensionState(['resolved'])).toBe('resolved')
    expect(runTensionState(['resolved', 'resolved'])).toBe('resolved')
  })
  it("mentionné sans preuve de résolution = 'open' (open, unknown, ou mélange)", () => {
    expect(runTensionState(['open'])).toBe('open')
    expect(runTensionState(['unknown'])).toBe('open')             // mentionné, pas prouvé résolu
    expect(runTensionState(['resolved', 'open'])).toBe('open')    // une occurrence ouverte → concern
    expect(runTensionState(['resolved', 'unknown'])).toBe('open') // reste un concern
    expect(runTensionState([null])).toBe('open')
  })
  it('liste vide → open (garde ; ne devrait pas arriver)', () => {
    expect(runTensionState([])).toBe('open')
  })
})

describe('tensionTrajectory — carry-forward', () => {
  it('ouvert puis NON MENTIONNÉ → reste actif (le silence ne résout pas)', () => {
    const t = tensionTrajectory(['open', null, null])
    expect(t.map((x) => x.active)).toEqual([true, true, true])
    expect(t.map((x) => x.isNew)).toEqual([true, false, false])
  })
  it('ouvert puis RÉSOLU prouvé → devient inactif (la tension baisse), le silence reporte résolu', () => {
    const t = tensionTrajectory(['open', 'resolved', null])
    expect(t.map((x) => x.active)).toEqual([true, false, false])
  })
  it('résolu prouvé puis RÉOUVERT → redevient actif', () => {
    const t = tensionTrajectory(['resolved', 'open'])
    expect(t.map((x) => x.active)).toEqual([false, true])
  })
  it('première apparition résolue → jamais actif, aucune tension', () => {
    const t = tensionTrajectory(['resolved', null])
    expect(t.map((x) => x.active)).toEqual([false, false])
    expect(t.map((x) => x.isNew)).toEqual([false, false])
  })
  it('non mentionné AVANT la première apparition → inactif jusqu\'à apparition', () => {
    const t = tensionTrajectory([null, 'open', null])
    expect(t.map((x) => x.active)).toEqual([false, true, true])
    expect(t.map((x) => x.isNew)).toEqual([false, true, false])
  })
  it('isNew une seule fois (première apparition active)', () => {
    const t = tensionTrajectory(['open', 'open', 'open'])
    expect(t.map((x) => x.isNew)).toEqual([true, false, false])
  })
})

// P0-2d — sentinelle run MIXTE resolved + open : après dédup du fetch (fetchSiteHistoricalOccurrences
// alimente désormais Tension avec les mêmes occurrences brutes que la primitive partagée), la RÈGLE
// Tension doit rester STRICTEMENT inchangée. Un PV où le sujet est prouvé résolu sur un état ET encore
// ouvert sur un autre reste un concern ACTIF (before=open, after=open) — jamais une fausse résolution.
describe('P0-2d — run mixte resolved+open reste un concern (règle Tension inchangée)', () => {
  it("un PV mêlant une occurrence résolue et une ouverte → runTensionState = 'open'", () => {
    // c.-à-d. exactement ce que produit occs.map((o) => o.stateStatus) sur un run mixte
    expect(runTensionState(['resolved', 'open'])).toBe('open')
    expect(runTensionState(['open', 'resolved', 'resolved'])).toBe('open')
  })
  it('trajectoire ouvert → PV mixte → reste actif (aucune baisse, pas de régression non-mention)', () => {
    const t = tensionTrajectory([
      runTensionState(['open']),                 // PV1 : ouvert
      runTensionState(['resolved', 'open']),     // PV2 : mixte → open
    ])
    expect(t.map((x) => x.active)).toEqual([true, true])
    expect(t.map((x) => x.isNew)).toEqual([true, false])
  })
})
