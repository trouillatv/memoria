// Read model des relations d'un acteur (V3 étape 5A) — pipeline complet
// interactions → agrégation → temporel → vues triées & expliquées. Couvre le
// contrat Vincent : tri par force, départage déterministe, explication = force,
// tendance jamais dérivée du score, sources cliquables/non, état vide honnête,
// isolation (seuls les couples contenant self), indépendance à l'ordre d'entrée.

import { describe, expect, it } from 'vitest'
import {
  buildActorRelationViews, groupEcosystem, topRelations, trendUiLabel,
  type RelationViewLabels,
} from '@/lib/knowledge/actor-relation-view'
import { aggregateActorRelations } from '@/lib/knowledge/actor-relations'
import type { ActorInteraction, ActorRef } from '@/lib/knowledge/actor-interactions'

const ASOF = new Date('2026-07-28T00:00:00Z')
const DAY = 86_400_000
const shift = (n: number): string => new Date(ASOF.getTime() + n * DAY).toISOString().slice(0, 10)

// self = une entreprise ; ses relations : d'autres entreprises (co_casting) et des
// personnes (co_action, en tant que responsable).
const SELF: ActorRef = { kind: 'company', id: 'self' }
const casting = (siteId: string, from: string, to: string | null, other = 'coB'): ActorInteraction => ({
  actorA: refKey('company', 'self') <= refKey('company', other) ? { kind: 'company', id: 'self' } : { kind: 'company', id: other },
  actorB: refKey('company', 'self') <= refKey('company', other) ? { kind: 'company', id: other } : { kind: 'company', id: 'self' },
  kind: 'co_casting', occurredAt: from, activeFrom: from, activeTo: to, siteId, sourceType: 'site_intervenant', sourceId: siteId,
})
const action = (id: string, occurredAt: string, person = 'pA'): ActorInteraction => ({
  actorA: refKey('company', 'self') <= refKey('person', person) ? { kind: 'company', id: 'self' } : { kind: 'person', id: person },
  actorB: refKey('company', 'self') <= refKey('person', person) ? { kind: 'person', id: person } : { kind: 'company', id: 'self' },
  kind: 'co_action', occurredAt, actionId: id, sourceType: 'site_action', sourceId: id,
})
function refKey(kind: string, id: string) { return `${kind}:${id}` }

// Résolveurs simulés : libellés + hrefs (avec une source sans route fiable).
const LABELS: RelationViewLabels = {
  actor: (ref) => ({ kind: ref.kind as 'person' | 'company', id: ref.id, label: `${ref.kind}:${ref.id}`, href: `/x/${ref.id}` }),
  source: (kind, sourceId) => kind === 'co_action'
    ? { label: `Action ${sourceId}`, href: null }               // pas de route fiable → non cliquable
    : { label: `Chantier ${sourceId}`, href: `/sites/${sourceId}` },
}
const build = (ints: ActorInteraction[]) => buildActorRelationViews(SELF, ints, ASOF, LABELS)

describe('tri & départage', () => {
  it('1. classement par force décroissante', () => {
    const v = build([
      casting('s1', shift(-800), null, 'coWeak'),                 // 2
      action('a1', shift(-10)), action('a2', shift(-20)),         // pA : 3 + 3 = 6
    ])
    expect(v[0]!.actor.id).toBe('pA')  // 6 > 2
    expect(v[0]!.strength).toBeGreaterThan(v[1]!.strength)
  })

  it('2. départage déterministe à force égale (activité, récence, id)', () => {
    // Deux entreprises, même force (casting actif = 2), départagées par id stable.
    const v = build([casting('s1', shift(-800), null, 'coB'), casting('s2', shift(-800), null, 'coA')])
    expect(v.map((r) => r.actor.id)).toEqual(['coA', 'coB'])
  })
})

describe('affichage & états', () => {
  it('3-4. relation structurelle active → active + daysSinceLastInteraction 0', () => {
    const v = build([casting('s1', shift(-800), null)])
    expect(v[0]!.activeInteractionCount).toBe(1)
    expect(v[0]!.daysSinceLastInteraction).toBe(0)
  })

  it('5. insufficient_data → aucun qualificatif de tendance', () => {
    const v = build([action('a1', shift(-120))]) // 0 vs 3, somme 3 < 4
    expect(v[0]!.activity.trend).toBe('insufficient_data')
    expect(trendUiLabel(v[0]!.activity.trend)).toBeNull()
  })

  it('6. strengthEvolution.delta < 0 n’est PAS traduit en decreasing', () => {
    const v = build([action('a1', shift(-400))])
    expect(v[0]!.strengthEvolution.delta).toBeLessThan(0)
    expect(v[0]!.activity.trend).not.toBe('decreasing')
    expect(v[0]!.activity.trend).toBe('inactive')
  })

  it('7. inactive avec historique existant', () => {
    expect(build([action('a1', shift(-400))])[0]!.activity.trend).toBe('inactive')
  })

  it('8. new quand fenêtre précédente vide et courante non vide', () => {
    expect(build([action('a1', shift(-10))])[0]!.activity.trend).toBe('new')
  })

  it('12. état vide honnête (aucune relation)', () => {
    expect(build([])).toEqual([])
  })
})

describe('explicabilité', () => {
  it('9. Σ currentContribution des explications === force affichée', () => {
    const v = build([action('a1', shift(-10)), action('a2', shift(-400))])
    const sum = v[0]!.explanation.reduce((s, e) => s + e.currentContribution, 0)
    expect(v[0]!.strength).toBeCloseTo(sum)
  })

  it('10-11. source cliquable si route fiable, sinon non cliquable', () => {
    const v = build([casting('s1', shift(-800), null), action('a1', shift(-10))])
    const casExpl = v.flatMap((r) => r.explanation).find((e) => e.interactionType === 'co_casting')!
    const actExpl = v.flatMap((r) => r.explanation).find((e) => e.interactionType === 'co_action')!
    expect(casExpl.sourceHref).toBe('/sites/s1')  // route fiable
    expect(actExpl.sourceHref).toBeNull()          // pas de route → non cliquable
    expect(actExpl.sourceLabel).toBe('Action a1')  // libellé réel, jamais inventé au hasard
  })
})

describe('robustesse', () => {
  it('13. nombre maximal de relations appliqué APRÈS le tri', () => {
    const ints = Array.from({ length: 8 }, (_, i) => casting(`s${i}`, shift(-10), null, `co${i}`))
    const top = topRelations(build(ints), 5)
    expect(top).toHaveLength(5)
  })

  it('14. isolation : les couples ne contenant pas self sont ignorés', () => {
    const foreign: ActorInteraction = {
      actorA: { kind: 'company', id: 'coX' }, actorB: { kind: 'company', id: 'coY' },
      kind: 'co_casting', occurredAt: shift(-10), activeFrom: shift(-10), activeTo: null, siteId: 's9', sourceType: 'site_intervenant', sourceId: 's9',
    }
    const v = build([casting('s1', shift(-10), null, 'coB'), foreign])
    expect(v.map((r) => r.actor.id)).toEqual(['coB']) // jamais coX/coY
  })

  it('15. même asOf pour agrégation et temporel (force === score étape 3)', () => {
    const ints = [action('a1', shift(-10)), action('a2', shift(-400))]
    const step3 = aggregateActorRelations(ints, ASOF)[0]!.rawStrength
    expect(build(ints)[0]!.strength).toBeCloseTo(step3)
    expect(build(ints)[0]!.strengthEvolution.current).toBeCloseTo(step3)
  })

  it('16. indépendant de l’ordre d’entrée', () => {
    const ints = [casting('s1', shift(-800), null, 'coB'), action('a1', shift(-10)), action('a2', shift(-20))]
    expect(build(ints)).toEqual(build([...ints].reverse()))
  })

  it('écosystème : groupes cohérents sans qualificatif', () => {
    const eco = groupEcosystem(build([
      action('a1', shift(-10)),                       // new
      casting('s1', shift(-800), null, 'coStable'),   // stable
      action('old', shift(-400), 'pOld'),             // inactive
    ]))
    expect(eco.recent.some((r) => r.activity.trend === 'new')).toBe(true)
    expect(eco.inactive.some((r) => r.activity.trend === 'inactive')).toBe(true)
    expect(eco.principal.length).toBe(3)
  })

  it('mapping UI des tendances', () => {
    expect(trendUiLabel('new')).toBe('Nouvelle collaboration')
    expect(trendUiLabel('increasing')).toBe('Activité en hausse')
    expect(trendUiLabel('stable')).toBe('Activité stable')
    expect(trendUiLabel('decreasing')).toBe('Activité en baisse')
    expect(trendUiLabel('inactive')).toBe('Collaboration inactive')
    expect(trendUiLabel('insufficient_data')).toBeNull()
  })
})
