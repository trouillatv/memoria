import { describe, it, expect } from 'vitest'
import { deriveStateKey, groupPropositionsByState, deriveGroupThematicCategory } from '@/lib/db/occurrence-state-key'

// P3-D1 — un même sujet peut avoir N occurrences dans un rapport, MAIS seulement pour des états
// distincts. Cross-family → états distincts (N groupes). Same-family → même état (1 groupe, dédup).

const p = (proposal_family: string, label: string) => ({ proposal_family, label })

describe('deriveStateKey', () => {
  it('déterministe, normalisé (rejeu identique)', () => {
    expect(deriveStateKey('knowledge_fact')).toBe('knowledge_fact')
    expect(deriveStateKey('  Observation ')).toBe('observation')
    expect(deriveStateKey('action')).toBe(deriveStateKey('action'))
  })
})

describe('groupPropositionsByState — témoins Bella obligatoires (cross-family → N)', () => {
  it('Extincteurs : contrôlés (knowledge_fact) + à faire (observation) → 2 états', () => {
    const g = groupPropositionsByState([
      p('knowledge_fact', 'Extincteurs contrôlés par MIES en 04/23'),
      p('observation', 'Contrôle des extincteurs à faire - URGENT'),
    ])
    expect(g.size).toBe(2)
    expect([...g.keys()].sort()).toEqual(['knowledge_fact', 'observation'])
  })
  it('Nettoyage : réalisé (knowledge_fact) + à refaire (observation) → 2 états', () => {
    const g = groupPropositionsByState([
      p('knowledge_fact', 'Nettoyage conduits réalisé'),
      p('observation', 'Nettoyage conduits à faire - URGENT'),
    ])
    expect(g.size).toBe(2)
  })
  it('Éclairage : réalisé (knowledge_fact) + à refaire (action) → 2 états', () => {
    const g = groupPropositionsByState([
      p('knowledge_fact', 'Contrôle éclairage de sécurité réalisé le 22/03/2024'),
      p('action', "Contrôle de l'éclairage de sécurité à refaire"),
    ])
    expect(g.size).toBe(2)
  })
})

describe('groupPropositionsByState — dédup same-state (same-family → 1)', () => {
  it('deux reformulations knowledge_fact du même état → 1 occurrence', () => {
    const g = groupPropositionsByState([
      p('knowledge_fact', 'Plans et consignes OK'),
      p('knowledge_fact', 'Plans et consignes conformes'),
    ])
    expect(g.size).toBe(1)
    expect(g.get('knowledge_fact')).toHaveLength(2) // les deux preuves poolées dans l'unique état
  })
  it('trois observations reformulées → 1 occurrence', () => {
    const g = groupPropositionsByState([
      p('observation', 'Largeur réduite'),
      p('observation', 'Largeur de passage réduite par les frigos'),
      p('observation', 'Passage étroit (frigos)'),
    ])
    expect(g.size).toBe(1)
    expect(g.get('observation')).toHaveLength(3)
  })
  it('une seule proposition → un seul état', () => {
    const g = groupPropositionsByState([p('decision', 'Validation issue mall suffisante')])
    expect(g.size).toBe(1)
  })
  it('liste vide → aucune occurrence', () => {
    expect(groupPropositionsByState([]).size).toBe(0)
  })
})

describe('groupPropositionsByState — mélange réaliste', () => {
  it('2 knowledge_fact (dédup) + 1 observation (distinct) → 2 états', () => {
    const g = groupPropositionsByState([
      p('knowledge_fact', 'Extincteurs contrôlés 04/23'),
      p('knowledge_fact', 'Extincteurs vérifiés par MIES'),
      p('observation', 'Extincteurs à contrôler - URGENT'),
    ])
    expect(g.size).toBe(2)
    expect(g.get('knowledge_fact')).toHaveLength(2)
    expect(g.get('observation')).toHaveLength(1)
  })
})

describe('deriveGroupThematicCategory — R-1 (catégorie = classification du fait)', () => {
  it('catégorie unique → univocal', () => {
    expect(deriveGroupThematicCategory(['test_control'])).toEqual({ category: 'test_control', reason: 'univocal', distinct: ['test_control'] })
    expect(deriveGroupThematicCategory(['progress', 'progress'])).toEqual({ category: 'progress', reason: 'univocal', distinct: ['progress'] })
  })
  it('null/vides ignorés, un seul signal réel → univocal', () => {
    expect(deriveGroupThematicCategory([null, 'administrative', ''])).toEqual({ category: 'administrative', reason: 'univocal', distinct: ['administrative'] })
  })
  it('aucune catégorie (tout null/vide) → none, category null', () => {
    expect(deriveGroupThematicCategory([null, '', '  '])).toEqual({ category: null, reason: 'none', distinct: [] })
  })
  it('plusieurs catégories → null (conflict), jamais une dominante arbitraire ; distinct conservé', () => {
    const r = deriveGroupThematicCategory(['progress', 'progress', 'forecast'])
    expect(r.category).toBeNull()
    expect(r.reason).toBe('conflict')
    expect(r.distinct).toEqual(['forecast', 'progress'])
  })
  it('conflit → null quel que soit l\'ordre (rejeu stable, jamais de choix fabriqué)', () => {
    expect(deriveGroupThematicCategory(['test_control', 'administrative']).category).toBeNull()
    expect(deriveGroupThematicCategory(['administrative', 'test_control']).category).toBeNull()
    expect(deriveGroupThematicCategory(['administrative', 'test_control']).reason).toBe('conflict')
  })
})
