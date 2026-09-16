// Invariant permanent — import rétroactif / ordre d'ingestion.
// Promu depuis l'audit jetable _audit-temporal-retroactive.test.ts (FINAL CHECK LIVE
// WRITER RESOLVED-POINT MATCHING, GO Vincent) : les archives peuvent être importées
// dans n'importe quel ordre, MemorIA doit reconstruire la vérité selon les dates
// métier, jamais selon l'ordre d'ingestion. Aucun changement du réducteur.

import { describe, it, expect } from 'vitest'
import { deriveCanonicalCurrentState, type PvState } from './subject-state'

const occ = (effectiveDate: string, pvState: PvState) => ({ effectiveDate, pvState })

describe('deriveCanonicalCurrentState — invariant de permutation (ordre d\'ingestion)', () => {
  it('08/06 OPEN puis 22/07 RESOLVED, ingéré dans l\'ordre métier ou inversé → resolved dans les deux cas', () => {
    const inBusinessOrder = deriveCanonicalCurrentState({
      occurrences: [occ('2026-06-08', 'open'), occ('2026-07-22', 'resolved')],
      activeObjectsTotal: 0,
    })
    const inIngestionOrder = deriveCanonicalCurrentState({
      occurrences: [occ('2026-07-22', 'resolved'), occ('2026-06-08', 'open')],
      activeObjectsTotal: 0,
    })
    expect(inBusinessOrder.displayState).toBe('resolved')
    expect(inIngestionOrder).toEqual(inBusinessOrder)
  })

  it('reopened seulement si OPEN est métier-postérieur à RESOLVED, jamais si OPEN précède', () => {
    const openAfterResolved = deriveCanonicalCurrentState({
      occurrences: [occ('2026-06-08', 'resolved'), occ('2026-07-22', 'open')],
      activeObjectsTotal: 0,
    })
    const sameIngestedReversed = deriveCanonicalCurrentState({
      occurrences: [occ('2026-07-22', 'open'), occ('2026-06-08', 'resolved')],
      activeObjectsTotal: 0,
    })
    expect(openAfterResolved.displayState).toBe('reopened')
    expect(sameIngestedReversed).toEqual(openAfterResolved)

    // Contre-épreuve : OPEN métier-antérieur à RESOLVED → jamais reopened, quel que soit l'ordre d'ingestion.
    const openBeforeResolved = deriveCanonicalCurrentState({
      occurrences: [occ('2026-06-08', 'open'), occ('2026-07-22', 'resolved')],
      activeObjectsTotal: 0,
    })
    expect(openBeforeResolved.displayState).not.toBe('reopened')
    expect(openBeforeResolved.displayState).toBe('resolved')
  })

  it('les 6 permutations d\'un jeu de 3 occurrences produisent un résultat strictement identique', () => {
    const events = [occ('2026-01-15', 'open'), occ('2026-06-08', 'open'), occ('2026-07-22', 'resolved')]
    const permute = <T,>(arr: T[]): T[][] =>
      arr.length <= 1 ? [arr] : arr.flatMap((x, i) => permute([...arr.slice(0, i), ...arr.slice(i + 1)]).map((p) => [x, ...p]))
    const results = permute(events).map((occs) => deriveCanonicalCurrentState({ occurrences: occs, activeObjectsTotal: 0 }))
    for (const r of results) expect(r).toEqual(results[0])
    expect(results[0].displayState).toBe('resolved')
  })
})
