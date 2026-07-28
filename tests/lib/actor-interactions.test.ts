// Interactions élémentaires (V3 étape 2) — faits datés, canonicalisés, dédupliqués,
// sourcés, SANS pondération. Couvre le contrat Vincent : chevauchement réel,
// occurrences non écrasées, durée vs événement, pas d'inférence transitive,
// déduplication du couple, dates manquantes/incohérentes.

import { describe, expect, it } from 'vitest'
import { buildActorInteractions, type ActorInteractionInputs } from '@/lib/knowledge/actor-interactions'

const base = (): ActorInteractionInputs => ({ castings: [], teamMemberships: [], actions: [] })

describe('co_casting', () => {
  it('même chantier, périodes qui se chevauchent → une interaction entreprise↔entreprise', () => {
    const r = buildActorInteractions({
      ...base(),
      castings: [
        { siteId: 's1', companyId: 'coA', from: '2026-03-01', to: null },
        { siteId: 's1', companyId: 'coB', from: '2026-03-12', to: null },
      ],
    })
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({
      kind: 'co_casting', siteId: 's1', sourceType: 'site_intervenant', sourceId: 's1',
      activeFrom: '2026-03-12', activeTo: null, occurredAt: '2026-03-12',
    })
    // Couple canonique (company:coA <= company:coB), symétrique.
    expect([r[0]!.actorA.id, r[0]!.actorB.id]).toEqual(['coA', 'coB'])
  })

  it('même chantier mais périodes NON chevauchantes → aucune interaction', () => {
    const r = buildActorInteractions({
      ...base(),
      castings: [
        { siteId: 's1', companyId: 'coA', from: '2024-01-01', to: '2024-06-30' },
        { siteId: 's1', companyId: 'coB', from: '2026-01-01', to: null },
      ],
    })
    expect(r).toHaveLength(0)
  })

  it('deux chantiers partagés → deux interactions (occurrences non écrasées)', () => {
    const r = buildActorInteractions({
      ...base(),
      castings: [
        { siteId: 's1', companyId: 'coA', from: '2026-01-01', to: null },
        { siteId: 's1', companyId: 'coB', from: '2026-01-01', to: null },
        { siteId: 's2', companyId: 'coA', from: '2026-02-01', to: null },
        { siteId: 's2', companyId: 'coB', from: '2026-02-01', to: null },
      ],
    })
    expect(r).toHaveLength(2)
    expect(new Set(r.map((i) => i.siteId))).toEqual(new Set(['s1', 's2']))
  })

  it('pas d’inférence transitive : les personnes des entreprises ne sont PAS reliées entre elles', () => {
    const r = buildActorInteractions({
      ...base(),
      castings: [
        { siteId: 's1', companyId: 'coA', from: '2026-01-01', to: null },
        { siteId: 's1', companyId: 'coB', from: '2026-01-01', to: null },
      ],
    })
    // Uniquement coA↔coB (entreprises), aucune paire de personnes.
    expect(r.every((i) => i.actorA.kind === 'company' && i.actorB.kind === 'company')).toBe(true)
  })
})

describe('co_team', () => {
  it('même équipe, appartenances chevauchantes → personne↔personne', () => {
    const r = buildActorInteractions({
      ...base(),
      teamMemberships: [
        { teamId: 't1', contactId: 'pA', from: '2026-01-01', to: null },
        { teamId: 't1', contactId: 'pB', from: '2026-02-01', to: null },
      ],
    })
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ kind: 'co_team', teamId: 't1', activeFrom: '2026-02-01', activeTo: null })
    expect(r[0]!.actorA.kind).toBe('person')
  })

  it('sortie d’équipe avant l’arrivée de l’autre → aucune interaction', () => {
    const r = buildActorInteractions({
      ...base(),
      teamMemberships: [
        { teamId: 't1', contactId: 'pA', from: '2026-01-01', to: '2026-01-31' },
        { teamId: 't1', contactId: 'pB', from: '2026-03-01', to: null },
      ],
    })
    expect(r).toHaveLength(0)
  })

  it('appartenance à plusieurs équipes communes → une interaction par équipe', () => {
    const r = buildActorInteractions({
      ...base(),
      teamMemberships: [
        { teamId: 't1', contactId: 'pA', from: '2026-01-01', to: null },
        { teamId: 't1', contactId: 'pB', from: '2026-01-01', to: null },
        { teamId: 't2', contactId: 'pA', from: '2026-01-01', to: null },
        { teamId: 't2', contactId: 'pB', from: '2026-01-01', to: null },
      ],
    })
    expect(r).toHaveLength(2)
    expect(new Set(r.map((i) => i.teamId))).toEqual(new Set(['t1', 't2']))
  })
})

describe('co_action', () => {
  it('référent + responsable → une interaction personne↔entreprise (événement ponctuel)', () => {
    const r = buildActorInteractions({
      ...base(),
      actions: [{ id: 'a1', contactId: 'pA', companyId: 'coA', occurredAt: '2026-07-18' }],
    })
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ kind: 'co_action', actionId: 'a1', occurredAt: '2026-07-18', sourceType: 'site_action', sourceId: 'a1' })
    // Événement ponctuel : pas d'intervalle.
    expect(r[0]!.activeFrom).toBeUndefined()
    expect(r[0]!.activeTo).toBeUndefined()
    expect(new Set([r[0]!.actorA.kind, r[0]!.actorB.kind])).toEqual(new Set(['person', 'company']))
  })

  it('plusieurs actions entre le même couple → autant d’interactions (non écrasées)', () => {
    const r = buildActorInteractions({
      ...base(),
      actions: [
        { id: 'a1', contactId: 'pA', companyId: 'coA', occurredAt: '2026-07-10' },
        { id: 'a2', contactId: 'pA', companyId: 'coA', occurredAt: '2026-07-20' },
      ],
    })
    expect(r).toHaveLength(2)
    expect(new Set(r.map((i) => i.actionId))).toEqual(new Set(['a1', 'a2']))
  })

  it('action sans contact OU sans entreprise → aucune interaction', () => {
    const r = buildActorInteractions({
      ...base(),
      actions: [
        { id: 'a1', contactId: null, companyId: 'coA', occurredAt: '2026-07-10' },
        { id: 'a2', contactId: 'pA', companyId: null, occurredAt: '2026-07-10' },
      ],
    })
    expect(r).toHaveLength(0)
  })
})

describe('robustesse', () => {
  it('déduplication du couple : un couple identique sur le même contexte n’est compté qu’une fois', () => {
    const r = buildActorInteractions({
      ...base(),
      castings: [
        // coB déclaré AVANT coA + rôles multiples → toujours une seule interaction canonique.
        { siteId: 's1', companyId: 'coB', from: '2026-01-01', to: null },
        { siteId: 's1', companyId: 'coA', from: '2026-01-01', to: null },
        { siteId: 's1', companyId: 'coA', from: '2026-02-01', to: null },
      ],
    })
    expect(r).toHaveLength(1)
    expect([r[0]!.actorA.id, r[0]!.actorB.id]).toEqual(['coA', 'coB'])
  })

  it('dates manquantes ou incohérentes → ligne ignorée, jamais d’interaction indatable', () => {
    const r = buildActorInteractions({
      ...base(),
      castings: [
        { siteId: 's1', companyId: 'coA', from: null, to: null },            // indatable
        { siteId: 's1', companyId: 'coB', from: '2026-05-01', to: '2026-01-01' }, // incohérente (from > to)
      ],
      actions: [{ id: 'a1', contactId: 'pA', companyId: 'coA', occurredAt: null }], // action sans date
    })
    expect(r).toHaveLength(0)
  })
})
