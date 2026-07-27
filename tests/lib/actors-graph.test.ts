// Lot 2B.4 — composition PURE du graphe des acteurs. Vérifie que seules des relations
// RÉELLES produisent des liens, qu'aucun nœud n'est orphelin, et que la couleur suit
// l'état d'attention (graphe d'attention, pas simple schéma).

import { describe, expect, it } from 'vitest'
import { buildActorsGraph, type ActorsGraphInputs } from '@/lib/knowledge/actors-graph'

function base(): ActorsGraphInputs {
  return {
    persons: [], companies: [], teams: [], siteNames: [],
    fieldMemberships: [], missions: [], casting: [], openActions: [],
  }
}

describe('buildActorsGraph', () => {
  it('graphe vide', () => {
    expect(buildActorsGraph(base())).toEqual({ nodes: [], edges: [] })
  })

  it('relations structurelles réelles : personne→entreprise, membre→équipe, équipe→chantier, entreprise→chantier', () => {
    const g = buildActorsGraph({
      ...base(),
      persons: [{ id: 'c1', name: 'Joseph', sub: null, level: 'ok', historical: false, companyId: 'co1' }],
      companies: [{ id: 'co1', name: 'Clim Austral', sub: null, level: 'ok', historical: false }],
      teams: [{ id: 't1', name: 'Élec', sub: null, level: 'ok', historical: false }],
      siteNames: [{ id: 's1', name: 'Petro Attiti' }],
      fieldMemberships: [{ contactId: 'c1', teamId: 't1' }],
      missions: [{ siteId: 's1', teamId: 't1' }],
      casting: [{ companyId: 'co1', siteId: 's1' }],
    })
    const rels = g.edges.map((e) => `${e.a}->${e.b}:${e.rel}`)
    expect(rels).toContain('p_c1->co_co1:belongs_to')
    expect(rels).toContain('p_c1->tm_t1:member_of')
    expect(rels).toContain('tm_t1->s_s1:mobilized_on')
    expect(rels).toContain('co_co1->s_s1:intervenes_on')
    // Le chantier n'apparaît QUE parce qu'il est relié (jamais orphelin).
    expect(g.nodes.find((n) => n.id === 's_s1')?.kind).toBe('site')
    expect(g.edges.find((e) => e.rel === 'belongs_to')?.label).toBe('appartient à')
  })

  it('action ouverte : nœud + liens référent/responsable, jamais si non reliée à un acteur', () => {
    const g = buildActorsGraph({
      ...base(),
      persons: [{ id: 'c1', name: 'Joseph', sub: null, level: 'urgent', historical: false, companyId: null }],
      companies: [{ id: 'co1', name: 'SOTRAP', sub: null, level: 'ok', historical: false }],
      siteNames: [{ id: 's1', name: 'Petro' }],
      openActions: [
        { id: 'a1', title: 'Repérage', siteId: 's1', contactId: 'c1', companyId: 'co1', overdue: true },
        { id: 'a2', title: 'Orpheline', siteId: 's1', contactId: null, companyId: null, overdue: false },
      ],
    })
    expect(g.nodes.find((n) => n.id === 'ac_a1')?.level).toBe('urgent') // en retard → rouge
    expect(g.edges.map((e) => `${e.a}->${e.b}:${e.rel}`)).toEqual(expect.arrayContaining([
      'p_c1->ac_a1:referent_of',
      'co_co1->ac_a1:responsible_of',
    ]))
    // a2 sans responsable → pas de nœud action (non relié à un acteur du périmètre).
    expect(g.nodes.find((n) => n.id === 'ac_a2')).toBeUndefined()
  })

  it('couleur = attention : le chantier porte le retard de ses actions ; l\'historique reste gris', () => {
    const g = buildActorsGraph({
      ...base(),
      persons: [{ id: 'c1', name: 'X', sub: null, level: 'ok', historical: false, companyId: 'co1' }],
      companies: [{ id: 'co1', name: 'Old', sub: null, level: 'ok', historical: true }],
      siteNames: [{ id: 's1', name: 'P' }],
      openActions: [{ id: 'a1', title: 'A', siteId: 's1', contactId: 'c1', companyId: null, overdue: true }],
    })
    expect(g.nodes.find((n) => n.id === 's_s1')?.level).toBe('urgent')
    expect(g.nodes.find((n) => n.id === 'co_co1')?.historical).toBe(true)
  })

  it('déduplique les liens identiques', () => {
    const g = buildActorsGraph({
      ...base(),
      persons: [{ id: 'c1', name: 'X', sub: null, level: 'ok', historical: false, companyId: 'co1' }],
      companies: [{ id: 'co1', name: 'Y', sub: null, level: 'ok', historical: false }],
      fieldMemberships: [{ contactId: 'c1', teamId: 't1' }, { contactId: 'c1', teamId: 't1' }],
      teams: [{ id: 't1', name: 'T', sub: null, level: 'ok', historical: false }],
    })
    expect(g.edges.filter((e) => e.rel === 'member_of')).toHaveLength(1)
  })
})
