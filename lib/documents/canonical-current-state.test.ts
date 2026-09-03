// P0-2 — Projection opérationnelle courante partagée d'un canonical_subject
//
// Vérifie la doctrine figée (Vincent) :
//   - unknown transparent ; resolved+open même date → open ; reopened après résolution ;
//   - déterminisme strict (permutation d'ordre → résultat identique).
//   - non-régression réelle sur RUS Dumbéa — Système Sprinkler (a1e1732e).

import { describe, it, expect } from 'vitest'
import {
  deriveCanonicalCurrentState,
  collapseCurrentStateByDate,
  type PvState,
} from './subject-state'

const occ = (effectiveDate: string, pvState: PvState) => ({ effectiveDate, pvState })

describe('deriveCanonicalCurrentState — doctrine P0-2', () => {
  it('1. resolved seul → resolved', () => {
    const r = deriveCanonicalCurrentState({ occurrences: [occ('2025-01-01', 'resolved')], activeObjectsTotal: 0 })
    expect(r.displayState).toBe('resolved')
    expect(r.triState).toBe('resolved')
    expect(r.provenOpen).toBe(false)
  })

  it('2. open seul → open', () => {
    const r = deriveCanonicalCurrentState({ occurrences: [occ('2025-01-01', 'open')], activeObjectsTotal: 0 })
    expect(r.displayState).toBe('open')
    expect(r.provenOpen).toBe(true)
  })

  it('3. unknown après open → open (unknown transparent)', () => {
    const r = deriveCanonicalCurrentState({
      occurrences: [occ('2025-01-01', 'open'), occ('2025-02-01', 'unknown')], activeObjectsTotal: 0,
    })
    expect(r.displayState).toBe('open')
    expect(r.triState).toBe('open')
  })

  it('4. unknown après resolved → resolved (unknown transparent)', () => {
    const r = deriveCanonicalCurrentState({
      occurrences: [occ('2025-01-01', 'resolved'), occ('2025-02-01', 'unknown')], activeObjectsTotal: 0,
    })
    expect(r.displayState).toBe('resolved')
    expect(r.triState).toBe('resolved')
  })

  it('5. resolved puis open → reopened', () => {
    const r = deriveCanonicalCurrentState({
      occurrences: [occ('2025-01-01', 'resolved'), occ('2025-02-01', 'open')], activeObjectsTotal: 0,
    })
    expect(r.displayState).toBe('reopened')
    expect(r.triState).toBe('open')
  })

  it('6. open puis resolved sans objet actif → resolved', () => {
    const r = deriveCanonicalCurrentState({
      occurrences: [occ('2025-01-01', 'open'), occ('2025-02-01', 'resolved')], activeObjectsTotal: 0,
    })
    expect(r.displayState).toBe('resolved')
    expect(r.provenOpen).toBe(false)
  })

  it('7. resolved + open MÊME date → open, jamais dépendant de l\'ordre', () => {
    const asc = deriveCanonicalCurrentState({
      occurrences: [occ('2025-01-01', 'resolved'), occ('2025-01-01', 'open')], activeObjectsTotal: 0,
    })
    const desc = deriveCanonicalCurrentState({
      occurrences: [occ('2025-01-01', 'open'), occ('2025-01-01', 'resolved')], activeObjectsTotal: 0,
    })
    expect(asc.displayState).toBe('open')
    expect(desc.displayState).toBe('open')
    expect(asc.displayState).toBe(desc.displayState)
  })

  it('8. resolved + objet actif rattaché → reopened (travail restant après résolution)', () => {
    const r = deriveCanonicalCurrentState({ occurrences: [occ('2025-01-01', 'resolved')], activeObjectsTotal: 2 })
    expect(r.provenOpen).toBe(true)
    expect(r.displayState).toBe('reopened')
  })

  it('9. occurrences uniquement unknown → unknown', () => {
    const r = deriveCanonicalCurrentState({
      occurrences: [occ('2025-01-01', 'unknown'), occ('2025-02-01', 'unknown')], activeObjectsTotal: 0,
    })
    expect(r.displayState).toBe('unknown')
    expect(r.provenOpen).toBe(false)
  })

  it('10. ordre d\'entrée permuté → résultat strictement identique', () => {
    const timeline = [
      occ('2025-05-23', 'resolved'), occ('2025-01-01', 'open'), occ('2025-03-01', 'unknown'),
      occ('2025-07-01', 'open'), occ('2025-02-01', 'resolved'),
    ]
    const forward = deriveCanonicalCurrentState({ occurrences: timeline, activeObjectsTotal: 0 })
    const reversed = deriveCanonicalCurrentState({ occurrences: [...timeline].reverse(), activeObjectsTotal: 0 })
    const shuffled = deriveCanonicalCurrentState({
      occurrences: [timeline[3], timeline[0], timeline[4], timeline[2], timeline[1]], activeObjectsTotal: 0,
    })
    expect(reversed).toEqual(forward)
    expect(shuffled).toEqual(forward)
  })

  it('objet actif seul (jamais résolu, tri-state unknown) → open, PAS reopened', () => {
    const r = deriveCanonicalCurrentState({ occurrences: [occ('2025-01-01', 'unknown')], activeObjectsTotal: 1 })
    expect(r.displayState).toBe('open')
    expect(r.triState).toBe('unknown')
  })
})

describe('collapseCurrentStateByDate — open-dominant, déterministe', () => {
  it('open prime sur resolved à la même date', () => {
    expect(collapseCurrentStateByDate([occ('d', 'resolved'), occ('d', 'open')])).toEqual(['open'])
    expect(collapseCurrentStateByDate([occ('d', 'open'), occ('d', 'resolved')])).toEqual(['open'])
  })
  it('resolved prime sur unknown à la même date', () => {
    expect(collapseCurrentStateByDate([occ('d', 'unknown'), occ('d', 'resolved')])).toEqual(['resolved'])
  })
  it('dates triées croissant, un état par date', () => {
    expect(collapseCurrentStateByDate([
      occ('2025-03-01', 'open'), occ('2025-01-01', 'resolved'), occ('2025-02-01', 'unknown'),
    ])).toEqual(['resolved', 'unknown', 'open'])
  })
})

describe('non-régression réelle — Système Sprinkler (RUS Dumbéa, a1e1732e)', () => {
  // Timeline documentaire réelle observée en base (effective_date → états atomiques),
  // effondrée open-dominant par date. Au 22/07/2026 : resolved (VGP semestrielle réalisée)
  // + open (réservation modif réseau) + unknown → open gagne. Résolutions antérieures
  // (07-10, 08-27) → le sujet est REOPENED, jamais Résolu ni Indéterminé.
  const sprinkler: { effectiveDate: string; pvState: PvState }[] = [
    occ('2025-01-29', 'unknown'), occ('2025-01-29', 'unknown'),
    occ('2025-03-27', 'open'),    occ('2025-03-27', 'unknown'),
    occ('2025-05-23', 'unknown'), occ('2025-05-23', 'open'),     occ('2025-05-23', 'resolved'),
    occ('2025-07-10', 'unknown'), occ('2025-07-10', 'resolved'), occ('2025-07-10', 'unknown'),
    occ('2025-08-27', 'resolved'), occ('2025-08-27', 'unknown'), occ('2025-08-27', 'unknown'), occ('2025-08-27', 'unknown'),
    occ('2025-12-03', 'unknown'), occ('2025-12-03', 'unknown'), occ('2025-12-03', 'unknown'),
    occ('2026-02-19', 'open'),    occ('2026-02-19', 'unknown'), occ('2026-02-19', 'resolved'),
    occ('2026-07-22', 'resolved'), occ('2026-07-22', 'open'),    occ('2026-07-22', 'unknown'), occ('2026-07-22', 'unknown'),
  ]

  it('projection opérationnelle = reopened (ni resolved ni unknown)', () => {
    // Même sans les 10 site_actions non rattachées (subject_thread_id=null, dette P0-3) :
    // le seul axe documentaire suffit à prouver REOPENED. activeObjectsTotal = 0.
    const r = deriveCanonicalCurrentState({ occurrences: sprinkler, activeObjectsTotal: 0 })
    expect(r.displayState).toBe('reopened')
    expect(r.triState).toBe('open')
    expect(r.provenOpen).toBe(true)
  })

  it('résultat identique quel que soit l\'ordre de retour des occurrences (anti-D2)', () => {
    const forward = deriveCanonicalCurrentState({ occurrences: sprinkler, activeObjectsTotal: 0 })
    const reversed = deriveCanonicalCurrentState({ occurrences: [...sprinkler].reverse(), activeObjectsTotal: 0 })
    expect(reversed).toEqual(forward)
  })
})
