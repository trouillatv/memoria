// Test UNITAIRE — P1-4B1. Empreinte de contexte canonique (fonction pure, aucune DB).
// La preuve d'intégration (contraintes, idempotence, effective) vit dans
// tests/lib/db/document-completion-resolution-constraints.test.ts.

import { describe, it, expect } from 'vitest'
import { computeContextFingerprint } from '@/lib/db/document-completion-resolution'

describe('computeContextFingerprint — canonique, ordre-invariante, dédupliquée', () => {
  it('même ensemble, ordre différent → même empreinte (test de permutation)', () => {
    const f1 = computeContextFingerprint(['a', 'b', 'c'])
    const f2 = computeContextFingerprint(['c', 'b', 'a'])
    const f3 = computeContextFingerprint(['b', 'a', 'c'])
    expect(f1).toBe(f2)
    expect(f1).toBe(f3)
  })

  it('doublons ignorés → même empreinte', () => {
    expect(computeContextFingerprint(['a', 'a', 'b'])).toBe(computeContextFingerprint(['a', 'b']))
  })

  it('ensembles différents → empreintes différentes', () => {
    expect(computeContextFingerprint(['a', 'b'])).not.toBe(computeContextFingerprint(['a', 'b', 'c']))
  })

  it('ensemble vide → empreinte stable et déterministe', () => {
    expect(computeContextFingerprint([])).toBe(computeContextFingerprint([]))
    expect(computeContextFingerprint([])).not.toBe(computeContextFingerprint(['a']))
  })

  it('empreinte = hex sha256 (64 caractères)', () => {
    expect(computeContextFingerprint(['a'])).toMatch(/^[0-9a-f]{64}$/)
  })
})
