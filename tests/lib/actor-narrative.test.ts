// Récit factuel d'un acteur (V3 Phase 2) — PUR, déterministe : on vérifie que
// buildActorNarrative assemble en PHRASES les faits DÉJÀ calculés (relations
// agrégées + contexte), sans rien inventer, dans le bon ordre, ≤ 8 phrases.

import { describe, expect, it } from 'vitest'
import { buildActorNarrative } from '@/lib/knowledge/actor-narrative'
import type { ActorRelationView, ActorRelationsResult, ActorRelationTrend } from '@/lib/knowledge/actor-relation-view'
import type { ActorContext, ActorContextEvent } from '@/lib/db/actor-context'

function view(
  kind: 'person' | 'company', id: string, label: string, trend: ActorRelationTrend, since: string | null,
): ActorRelationView {
  return {
    actor: { kind, id, label, href: null },
    relationType: 'co_action',
    rawStrength: 5, strength: 5,
    activity: { current: 3, previous: 2, delta: 1, trend },
    strengthEvolution: { current: 5, previous: 4, delta: 1 },
    daysSinceLastInteraction: 10,
    activeInteractionCount: 1, interactionCount: 2,
    explanation: since
      ? [{ interactionType: 'co_action', sourceId: 's', sourceLabel: 'S', sourceHref: null, observedAt: since, activeFrom: null, activeTo: null, isActive: true, rawContribution: 1, currentContribution: 1 }]
      : [],
  }
}

function result(relations: ActorRelationView[]): ActorRelationsResult {
  return { relations, ecosystem: { principal: relations, recent: [], inactive: [] } }
}

function ctx(events: Array<Partial<ActorContextEvent> & { date: string; label: string }>): ActorContext {
  const full = events.map((e): ActorContextEvent => ({ kind: 'report', sub: null, href: null, ...e }))
  return { latest: full, timeline: full }
}

describe('buildActorNarrative', () => {
  it('entreprise : ancienneté, collaboration la plus forte, interlocuteur, chantiers, dernière interaction', () => {
    const rels = result([
      view('person', 'p1', 'Joseph', 'stable', '2023-04-10'),
      view('company', 'co2', 'PAVE', 'increasing', '2024-01-05'),
    ])
    const context = ctx([
      { date: '2026-05-12', label: 'CR de visite', sub: 'Petro Attiti' },
      { date: '2026-03-01', label: 'Décision', sub: 'Grand Marché' },
    ])
    const out = buildActorNarrative('company', 'Clim Austral', rels, context)

    expect(out[0]).toBe('Vous travaillez avec Clim Austral depuis avril 2023.')
    expect(out.some((s) => s.startsWith('Collaboration la plus forte : Joseph'))).toBe(true)
    expect(out).toContain('En lien avec 2 acteurs au total.')
    expect(out).toContain('Interlocuteur principal : Joseph.')
    expect(out.some((s) => s.startsWith('Chantiers concernés :'))).toBe(true)
    expect(out.some((s) => s.startsWith('Dernière interaction : CR de visite (Petro Attiti), mai 2026'))).toBe(true)
    expect(out.length).toBeLessThanOrEqual(8)
  })

  it('personne : « Vous connaissez … » et pas de ligne « Interlocuteur principal »', () => {
    const out = buildActorNarrative('person', 'Vincent', result([view('company', 'co1', 'Clim', 'stable', '2022-09-01')]), null)
    expect(out[0]).toBe('Vous connaissez Vincent depuis septembre 2022.')
    expect(out.some((s) => s.startsWith('Interlocuteur principal'))).toBe(false)
  })

  it('risque : réseau limité à un seul partenaire', () => {
    const out = buildActorNarrative('company', 'Clim', result([view('person', 'p1', 'Jo', 'stable', '2023-01-01')]), null)
    expect(out).toContain('⚠ Réseau limité à un seul partenaire.')
  })

  it('risque : collaboration principale en baisse', () => {
    const out = buildActorNarrative('company', 'Clim', result([
      view('person', 'p1', 'Jo', 'decreasing', '2023-01-01'),
      view('company', 'co2', 'PAVE', 'stable', '2023-01-01'),
    ]), null)
    expect(out).toContain('⚠ La collaboration principale est en baisse.')
    expect(out).not.toContain('⚠ Réseau limité à un seul partenaire.')
  })

  it('risque : collaboration principale inactive', () => {
    const out = buildActorNarrative('company', 'Clim', result([
      view('person', 'p1', 'Jo', 'inactive', '2023-01-01'),
      view('company', 'co2', 'PAVE', 'stable', '2023-01-01'),
    ]), null)
    expect(out).toContain('⚠ La collaboration principale est inactive.')
  })

  it('réseau sans date structurelle → phrase de présence neutre', () => {
    const out = buildActorNarrative('company', 'Inconnu', result([view('person', 'p1', 'Jo', 'stable', null)]), null)
    expect(out[0]).toBe('Inconnu apparaît dans votre réseau.')
  })

  it('déterministe : même entrée → même sortie', () => {
    const build = () => buildActorNarrative('company', 'Clim', result([
      view('person', 'p1', 'Jo', 'stable', '2023-01-01'),
      view('company', 'co2', 'PAVE', 'increasing', '2024-01-01'),
    ]), ctx([{ date: '2026-05-12', label: 'CR', sub: 'Petro' }]))
    expect(build()).toEqual(build())
  })

  it('plus de 3 chantiers → forme condensée « Actif sur N chantiers »', () => {
    const context = ctx([
      { date: '2026-05-01', label: 'A', sub: 'S1' }, { date: '2026-04-01', label: 'B', sub: 'S2' },
      { date: '2026-03-01', label: 'C', sub: 'S3' }, { date: '2026-02-01', label: 'D', sub: 'S4' },
    ])
    const out = buildActorNarrative('company', 'Clim', result([view('person', 'p1', 'Jo', 'stable', '2023-01-01')]), context)
    expect(out).toContain('Actif sur 4 chantiers.')
  })
})
