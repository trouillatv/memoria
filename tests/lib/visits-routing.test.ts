// Visites terrain (mig 162) — routage par motif.
// MVP : le motif est facultatif. isProofMotive documente quels motifs iront
// vers le rail intervention (preuve signée) au cran 2 — fonction pure.

import { describe, it, expect } from 'vitest'
import { isProofMotive } from '@/lib/db/visits'

describe('isProofMotive — routage vers le rail preuve (cran 2)', () => {
  it('réception / levée de réserves / maintenance ⇒ rail preuve', () => {
    expect(isProofMotive('reception')).toBe(true)
    expect(isProofMotive('levee_reserves')).toBe(true)
    expect(isProofMotive('maintenance')).toBe(true)
  })

  it('contrôle / réunion / constat / libre ⇒ rail mémoire', () => {
    expect(isProofMotive('controle')).toBe(false)
    expect(isProofMotive('reunion')).toBe(false)
    expect(isProofMotive('constat')).toBe(false)
    expect(isProofMotive('libre')).toBe(false)
  })
})
