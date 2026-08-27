import { describe, it, expect } from 'vitest'
import { collapseLmcaOccurrencesByDate, computeLmcaFromOccurrences, type LmcaOccurrence } from '@/lib/documents/subject-state'

// P3-D1 — la multiplicité atomique (N occurrences/états d'un sujet dans un même document, même
// effective_date) ne doit pas fabriquer de changement LMCA intra-document ni dépendre de l'ordre.

const o = (effectiveDate: string, pvState: LmcaOccurrence['pvState'], objectSig = ''): LmcaOccurrence => ({ effectiveDate, pvState, objectSig })

describe('collapseLmcaOccurrencesByDate', () => {
  it('NO-OP sur données mono-occurrence (1 par date)', () => {
    const occs = [o('2024-01-01', 'open'), o('2025-01-01', 'resolved')]
    expect(collapseLmcaOccurrencesByDate(occs)).toEqual(occs)
  })

  it('effondre 2 états du même jour en 1 point (agrégation resolved>open>unknown)', () => {
    const collapsed = collapseLmcaOccurrencesByDate([o('2025-08-05', 'resolved'), o('2025-08-05', 'open')])
    expect(collapsed).toHaveLength(1)
    expect(collapsed[0]).toEqual({ effectiveDate: '2025-08-05', pvState: 'resolved', objectSig: '' })
  })

  it('déterministe : indépendant de l’ordre des ex-æquo', () => {
    const a = collapseLmcaOccurrencesByDate([o('2025-08-05', 'resolved'), o('2025-08-05', 'open')])
    const b = collapseLmcaOccurrencesByDate([o('2025-08-05', 'open'), o('2025-08-05', 'resolved')])
    expect(a).toEqual(b)
  })

  it('union triée des objectSig d’une même date', () => {
    const c = collapseLmcaOccurrencesByDate([o('2025-08-05', 'open', 'z'), o('2025-08-05', 'open', 'a')])
    expect(c[0].objectSig).toBe('a|z')
  })

  it('préserve l’ordre chronologique des dates distinctes', () => {
    const c = collapseLmcaOccurrencesByDate([o('2024-07-19', 'resolved'), o('2025-08-05', 'open'), o('2025-08-05', 'resolved')])
    expect(c.map((x) => x.effectiveDate)).toEqual(['2024-07-19', '2025-08-05'])
  })

  it('LMCA identique via collapse : témoin éclairage (réalisé+à refaire même PV) ne crée pas de faux changement', () => {
    // Sans collapse : réalisé→open même date fabriquerait un REOPEN artificiel intra-document.
    // Avec collapse : une occurrence 2025 agrégée = resolved (resolved>open), pas de changement vs 2024.
    const raw = [o('2024-07-19', 'resolved'), o('2025-08-05', 'resolved'), o('2025-08-05', 'open')]
    const viaCollapse = computeLmcaFromOccurrences(collapseLmcaOccurrencesByDate(raw))
    // baseline = 2024 ; 2025 agrégé resolved = pas de changement → LMCA reste 2024
    expect(viaCollapse.lastMeaningfulChangeAt).toBe('2024-07-19')
  })
})
