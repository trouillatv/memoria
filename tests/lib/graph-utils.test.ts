import { describe, it, expect } from 'vitest'
import { connectivitySizeBonus } from '@/lib/graph/graph-utils'

// P1-INT-3 — taille de nœud = degré réel, plafonnée, MÊME définition sur les
// trois familles de graphe (Explorer, Acteurs, Collaboration). Le plafond
// protège la lisibilité : un hub à 50 connexions ne doit pas écraser le reste.
describe('connectivitySizeBonus', () => {
  it('aucun bonus pour un nœud isolé ou avec une seule connexion', () => {
    expect(connectivitySizeBonus(0)).toBe(0)
    expect(connectivitySizeBonus(1)).toBe(0)
  })

  it('bonus croissant avec le degré, jamais négatif', () => {
    const b2 = connectivitySizeBonus(2)
    const b5 = connectivitySizeBonus(5)
    const b10 = connectivitySizeBonus(10)
    expect(b2).toBeGreaterThan(0)
    expect(b5).toBeGreaterThan(b2)
    expect(b10).toBeGreaterThan(b5)
  })

  it('plafonné à +10 px, même pour un hub à très forte connectivité', () => {
    expect(connectivitySizeBonus(50)).toBe(10)
    expect(connectivitySizeBonus(1000)).toBe(10)
  })
})
