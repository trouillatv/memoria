// Lot 2B.4 — composition PURE du graphe des acteurs. Vérifie que seules des relations
// RÉELLES produisent des liens, qu'aucun nœud n'est orphelin, et que la couleur suit
// l'état d'attention (graphe d'attention, pas simple schéma).

import { describe, expect, it } from 'vitest'
import { buildActorsGraph, egoSubgraph, shortestPath, graphTimeline, graphKinds, PERSPECTIVES, DEFAULT_PERSPECTIVE, type ActorsGraphInputs } from '@/lib/knowledge/actors-graph'
import { narrateActorInGraph } from '@/lib/knowledge/actor-narration'

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

  it('egoSubgraph : voisinage à profondeur bornée, centré sur un nœud', () => {
    const g = buildActorsGraph({
      ...base(),
      persons: [{ id: 'c1', name: 'Centre', sub: null, level: 'ok', historical: false, companyId: 'co1' }],
      companies: [{ id: 'co1', name: 'Co', sub: null, level: 'ok', historical: false }],
      teams: [{ id: 't1', name: 'T', sub: null, level: 'ok', historical: false }],
      siteNames: [{ id: 's1', name: 'S' }],
      fieldMemberships: [{ contactId: 'c1', teamId: 't1' }],
      missions: [{ siteId: 's1', teamId: 't1' }],
    })
    // Depth 1 depuis la personne : entreprise + équipe (voisins directs), pas encore le chantier.
    const d1 = egoSubgraph(g, 'p_c1', 1)
    expect(d1.nodes.map((n) => n.id).sort()).toEqual(['co_co1', 'p_c1', 'tm_t1'])
    // Depth 2 : atteint le chantier via l'équipe.
    const d2 = egoSubgraph(g, 'p_c1', 2)
    expect(d2.nodes.map((n) => n.id)).toContain('s_s1')
    // Nœud absent → sous-graphe vide.
    expect(egoSubgraph(g, 'p_zzz', 2)).toEqual({ nodes: [], edges: [] })
  })

  it('les liens portent leur DÉBUT structurel quand il existe (joined_at, effective_from)', () => {
    const g = buildActorsGraph({
      ...base(),
      persons: [{ id: 'c1', name: 'X', sub: null, level: 'ok', historical: false, companyId: 'co1' }],
      companies: [{ id: 'co1', name: 'Y', sub: null, level: 'ok', historical: false }],
      teams: [{ id: 't1', name: 'T', sub: null, level: 'ok', historical: false }],
      siteNames: [{ id: 's1', name: 'S' }],
      fieldMemberships: [{ contactId: 'c1', teamId: 't1', joinedAt: '2026-03-12T08:00:00Z' }],
      casting: [{ companyId: 'co1', siteId: 's1', effectiveFrom: '2026-07-24' }],
    })
    expect(g.edges.find((e) => e.rel === 'member_of')?.since).toBe('2026-03-12')
    expect(g.edges.find((e) => e.rel === 'intervenes_on')?.since).toBe('2026-07-24')
    // Aucune date structurelle pour belongs_to → jamais une date inventée.
    expect(g.edges.find((e) => e.rel === 'belongs_to')?.since).toBeNull()
  })

  it('shortestPath (mode Suivre) : chemin le plus court, index d\'arêtes traversées', () => {
    const g = buildActorsGraph({
      ...base(),
      persons: [{ id: 'c1', name: 'Joseph', sub: null, level: 'ok', historical: false, companyId: 'co1' }],
      companies: [{ id: 'co1', name: 'Clim', sub: null, level: 'ok', historical: false }],
      teams: [{ id: 't1', name: 'Élec', sub: null, level: 'ok', historical: false }],
      siteNames: [{ id: 's1', name: 'Petro' }],
      fieldMemberships: [{ contactId: 'c1', teamId: 't1' }],
      missions: [{ siteId: 's1', teamId: 't1' }],
      casting: [{ companyId: 'co1', siteId: 's1' }],
    })
    const p = shortestPath(g, 'p_c1', 's_s1')!
    expect(p.nodes[0]).toBe('p_c1')
    expect(p.nodes[p.nodes.length - 1]).toBe('s_s1')
    expect(p.nodes).toHaveLength(3) // p_c1 → tm_t1 → s_s1 (plus court que via l'entreprise)
    expect(p.edgeIndexes).toHaveLength(2)
    expect(shortestPath(g, 'p_c1', 'zzz')).toBeNull()
  })

  it('narration : phrases factuelles depuis les relations structurelles', () => {
    const g = buildActorsGraph({
      ...base(),
      persons: [{ id: 'c1', name: 'Joseph', sub: null, level: 'urgent', historical: false, companyId: 'co1' }],
      companies: [{ id: 'co1', name: 'Clim Austral', sub: null, level: 'ok', historical: false }],
      teams: [{ id: 't1', name: 'Électricité', sub: null, level: 'ok', historical: false }],
      siteNames: [{ id: 's1', name: 'Petro' }],
      fieldMemberships: [{ contactId: 'c1', teamId: 't1' }],
      openActions: [
        { id: 'a1', title: 'A', siteId: 's1', contactId: 'c1', companyId: null, overdue: true },
        { id: 'a2', title: 'B', siteId: 's1', contactId: 'c1', companyId: null, overdue: false },
      ],
    })
    const s = narrateActorInGraph('p_c1', g).join(' ')
    expect(s).toContain('Joseph travaille chez Clim Austral.')
    expect(s).toContain('Membre de l’équipe Électricité.')
    expect(s).toContain('Référent de 2 actions ouvertes, dont 1 en retard.')
    expect(narrateActorInGraph('inconnu', g)).toEqual([])
  })

  it('chronologie (le film) : jours datés + première apparition ; relation NON datée = depuis toujours', () => {
    const g = buildActorsGraph({
      ...base(),
      persons: [{ id: 'c1', name: 'X', sub: null, level: 'ok', historical: false, companyId: 'co1' }],
      companies: [{ id: 'co1', name: 'Y', sub: null, level: 'ok', historical: false }],
      teams: [{ id: 't1', name: 'T', sub: null, level: 'ok', historical: false }],
      fieldMemberships: [{ contactId: 'c1', teamId: 't1', joinedAt: '2026-03-01T00:00:00Z' }],
      // belongs_to c1→co1 n'a pas de date : c1 (relation non datée) reste « depuis toujours ».
    })
    const { days, firstSeen } = graphTimeline(g)
    expect(days).toEqual(['2026-03-01'])
    expect(firstSeen.get('p_c1')).toBeNull()          // a une relation non datée
    expect(firstSeen.get('co_co1')).toBeNull()        // idem
    expect(firstSeen.get('tm_t1')).toBe('2026-03-01') // n'a QUE la relation datée
  })

  it('companyId sur les nœuds (fond coloré par entreprise) : personne→sa société, entreprise→elle-même, chantier→null', () => {
    const g = buildActorsGraph({
      ...base(),
      persons: [
        { id: 'c1', name: 'Joseph', sub: null, level: 'ok', historical: false, companyId: 'co1' },
        { id: 'c2', name: 'Sans société', sub: null, level: 'ok', historical: false, companyId: null },
      ],
      companies: [{ id: 'co1', name: 'Clim Austral', sub: null, level: 'ok', historical: false }],
      siteNames: [{ id: 's1', name: 'Petro' }],
      casting: [{ companyId: 'co1', siteId: 's1' }],
    })
    expect(g.nodes.find((n) => n.id === 'p_c1')?.companyId).toBe('co1')   // personne → sa société
    expect(g.nodes.find((n) => n.id === 'p_c2')?.companyId).toBeNull()    // personne sans société
    expect(g.nodes.find((n) => n.id === 'co_co1')?.companyId).toBe('co1') // entreprise → elle-même
    expect(g.nodes.find((n) => n.id === 's_s1')?.companyId).toBeNull()    // chantier → neutre
  })

  it('graphKinds : natures RÉELLEMENT présentes (pilote les couches proposées)', () => {
    const g = buildActorsGraph({
      ...base(),
      persons: [{ id: 'c1', name: 'X', sub: null, level: 'ok', historical: false, companyId: 'co1' }],
      companies: [{ id: 'co1', name: 'Y', sub: null, level: 'ok', historical: false }],
    })
    expect(graphKinds(g)).toEqual(new Set(['person', 'company']))
    expect(graphKinds({ nodes: [], edges: [] })).toEqual(new Set())
  })

  it('lectures : « Tout » = toutes natures ; chaque lecture ne cible que des natures connues + une question', () => {
    const all = PERSPECTIVES.find((p) => p.id === 'all')!
    expect(all.kinds).toBeNull() // « Tout » ne filtre jamais
    const known = new Set(['person', 'company', 'team', 'site', 'action'])
    for (const p of PERSPECTIVES) {
      expect(p.hint.length).toBeGreaterThan(0) // chaque lecture affiche SA question
      if (p.kinds) for (const k of p.kinds) expect(known.has(k)).toBe(true)
    }
    // La lecture par défaut de la vue d'ensemble existe et n'est pas « Tout ».
    expect(PERSPECTIVES.some((p) => p.id === DEFAULT_PERSPECTIVE)).toBe(true)
    expect(DEFAULT_PERSPECTIVE).not.toBe('all')
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
