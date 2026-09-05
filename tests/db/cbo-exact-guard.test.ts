import { describe, it, expect } from 'vitest'
import { chooseExactGuardTarget } from '@/lib/db/canonical-business-object-attach'

// P3-3a — garde anti-récidive CBO exact-byte-identique.
// Les lignes reçues sont DÉJÀ filtrées en SQL sur (site, sujet, type, label strict) ;
// le helper ne décide que du survivor déterministe : le plus ancien (created_at puis id).

describe('chooseExactGuardTarget', () => {
  it('aucun exact-dup → null (création normale)', () => {
    expect(chooseExactGuardTarget([])).toBeNull()
  })

  it('un seul CBO exact existant → cible = lui', () => {
    expect(chooseExactGuardTarget([{ id: 'a', created_at: '2026-01-01' }])).toBe('a')
  })

  it('plusieurs exacts → le plus ancien (created_at)', () => {
    const r = chooseExactGuardTarget([
      { id: 'b', created_at: '2026-03-01' },
      { id: 'a', created_at: '2026-01-01' },
      { id: 'c', created_at: '2026-02-01' },
    ])
    expect(r).toBe('a')
  })

  it('égalité de created_at → départage stable par id', () => {
    const r = chooseExactGuardTarget([
      { id: 'zeta', created_at: '2026-09-03' },
      { id: 'alpha', created_at: '2026-09-03' },
    ])
    expect(r).toBe('alpha')
  })

  it('déterministe : l’ordre d’entrée n’influence pas le résultat', () => {
    const rows = [
      { id: 'c', created_at: '2026-02-01' },
      { id: 'a', created_at: '2026-01-01' },
      { id: 'b', created_at: '2026-01-01' },
    ]
    const forward = chooseExactGuardTarget(rows)
    const reversed = chooseExactGuardTarget([...rows].reverse())
    expect(forward).toBe('a')
    expect(reversed).toBe('a')
  })
})
