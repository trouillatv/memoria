// Layout hiérarchique (Organigramme, V3 UX) + titre vivant — PURS, déterministes.

import { describe, expect, it } from 'vitest'
import { hierarchicalLayout } from '@/lib/knowledge/graph-layouts'
import { structuralGraphSummary, collaborationGraphSummary } from '@/lib/knowledge/graph-summary'
import { buildActorsGraph } from '@/lib/knowledge/actors-graph'
import type { CollaborationGraphView } from '@/lib/knowledge/collaboration-graph'

function orgGraph() {
  return buildActorsGraph({
    persons: [
      { id: 'c1', name: 'Joseph', sub: null, level: 'ok', historical: false, companyId: 'co1' },
      { id: 'c2', name: 'Marc', sub: null, level: 'ok', historical: false, companyId: 'co1' },
      { id: 'c3', name: 'Vincent', sub: null, level: 'ok', historical: false, companyId: 'co2' },
      { id: 'c4', name: 'Sans société', sub: null, level: 'ok', historical: false, companyId: null },
    ],
    companies: [
      { id: 'co1', name: 'Clim Austral', sub: null, level: 'ok', historical: false },
      { id: 'co2', name: 'PAVE', sub: null, level: 'ok', historical: false },
    ],
    teams: [{ id: 't1', name: 'Élec', sub: null, level: 'ok', historical: false }],
    siteNames: [], fieldMemberships: [{ contactId: 'c1', teamId: 't1' }], missions: [], casting: [], openActions: [],
  })
}

describe('hierarchicalLayout', () => {
  it('entreprises en en-tête (y=0), personnes empilées et ALIGNÉES sous l\'entreprise', () => {
    const { positions: pos } = hierarchicalLayout(orgGraph())
    const co1 = pos.get('co_co1')!, jo = pos.get('p_c1')!, marc = pos.get('p_c2')!
    expect(co1.y).toBe(0)                 // en-tête
    expect(jo.x).toBe(co1.x)              // parfaitement aligné
    expect(marc.x).toBe(co1.x)
    expect(jo.y).toBeGreaterThan(0)
    expect(marc.y).toBeGreaterThan(jo.y)  // empilées
  })

  it('entreprises triées par NOMBRE de collaborateurs (Clim 2 avant PAVE 1)', () => {
    const { positions: pos } = hierarchicalLayout(orgGraph())
    expect(pos.get('co_co1')!.x).toBeLessThan(pos.get('co_co2')!.x) // Clim (2 pers) à gauche de PAVE (1)
    expect(pos.get('p_c3')!.x).toBe(pos.get('co_co2')!.x)           // Vincent sous PAVE
  })

  it('bloc « Sans entreprise » + strate « Équipes » ; déterministe', () => {
    const a = hierarchicalLayout(orgGraph()), b = hierarchicalLayout(orgGraph())
    expect(a.positions.get('p_c4')).toBeDefined()
    expect(a.blocks.some((bl) => bl.title === 'Sans entreprise')).toBe(true)
    expect(a.blocks.some((bl) => bl.title === 'Équipes')).toBe(true)
    // Une carte par entreprise (title null) + orphelins + équipes.
    expect(a.blocks.filter((bl) => bl.title === null).length).toBe(2)
    expect([...a.positions.entries()]).toEqual([...b.positions.entries()])
  })
})

describe('titre vivant', () => {
  it('structurel : compte les natures visibles', () => {
    const g = orgGraph()
    expect(structuralGraphSummary(g, null)).toBe('2 entreprises · 4 personnes · 1 équipe')
    // Couche « personnes » masquée → non comptées.
    expect(structuralGraphSummary(g, new Set(['company', 'team']))).toBe('2 entreprises · 1 équipe')
  })

  it('collaboration : collaborations, fortes, récentes', () => {
    const view: CollaborationGraphView = {
      nodes: [],
      edges: [
        { a: 'company:a', b: 'company:b', strength: 6, interactionCount: 3, daysSinceLastInteraction: 0, trend: 'stable', activeInteractionCount: 3, breakdown: { co_casting: 3, co_action: 0, co_team: 0 } },
        { a: 'company:a', b: 'company:c', strength: 2, interactionCount: 1, daysSinceLastInteraction: 400, trend: 'inactive', activeInteractionCount: 0, breakdown: { co_casting: 1, co_action: 0, co_team: 0 } },
      ],
    }
    expect(collaborationGraphSummary(view)).toBe('2 collaborations observées · 1 forte · 1 récente')
  })
})
