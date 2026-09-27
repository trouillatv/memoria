// NORM-2 (mandat Vincent 2026-09-25) — mapping category×kind → section des
// Prestations prévues. Doit rester déterministe (aucune IA, aucun regex sur
// short_label) et ne jamais perdre un Engagement lors du regroupement.

import { describe, it, expect } from 'vitest'
import {
  computePlannedEngagementSynthesis,
  computePlannedEngagementTabCounts,
  filterPlannedEngagements,
  getPlannedEngagementSection,
  getSectionHomogeneousStatus,
  groupPlannedEngagementsBySection,
  plannedEngagementMatchesTab,
  PLANNED_ENGAGEMENT_SECTION_ORDER,
} from '@/lib/engagements/section'
import type { EngagementMission, PlannedEngagement } from '@/lib/db/engagements'
import type { EngagementAction } from '@/lib/db/site-action-engagement-links'
import type { EngagementCategory, EngagementKind } from '@/types/db'
import { buildMissionHealth } from '@/lib/missions/mission-health'

function engagement(overrides: Partial<PlannedEngagement> & { id: string }): PlannedEngagement {
  return {
    shortLabel: 'Label',
    category: 'other',
    kind: null,
    measurable: false,
    status: 'curated',
    createdAt: '2026-09-01T00:00:00Z',
    primaryProvenance: {
      documentId: null,
      documentFilename: null,
      pageNumber: null,
      excerpt: null,
      frequencyRaw: null,
    },
    additionalProvenance: [],
    ...overrides,
  }
}

describe('getPlannedEngagementSection — matrice déterministe', () => {
  it('category=frequency → recurring, quel que soit le kind', () => {
    expect(getPlannedEngagementSection({ category: 'frequency', kind: null })).toBe('recurring')
    expect(getPlannedEngagementSection({ category: 'frequency', kind: 'livrable' })).toBe('recurring')
  })

  it('kind=controle → quality_control même si category=reporting (kind prioritaire sur cette règle)', () => {
    expect(getPlannedEngagementSection({ category: 'reporting', kind: 'controle' })).toBe('quality_control')
  })

  it('category=quality (sans kind=controle) → quality_control', () => {
    expect(getPlannedEngagementSection({ category: 'quality', kind: 'obligation' })).toBe('quality_control')
  })

  it('category=reporting → reporting_deliverables', () => {
    expect(getPlannedEngagementSection({ category: 'reporting', kind: 'obligation' })).toBe('reporting_deliverables')
  })

  it('kind=livrable (category autre) → reporting_deliverables', () => {
    expect(getPlannedEngagementSection({ category: 'other', kind: 'livrable' })).toBe('reporting_deliverables')
  })

  it('category=compliance → safety_compliance', () => {
    expect(getPlannedEngagementSection({ category: 'compliance', kind: 'obligation' })).toBe('safety_compliance')
  })

  it('fallback déterministe : sla/delivery/other sans kind discriminant → other_event_kickoff', () => {
    expect(getPlannedEngagementSection({ category: 'sla', kind: 'objectif' })).toBe('other_event_kickoff')
    expect(getPlannedEngagementSection({ category: 'delivery', kind: 'obligation' })).toBe('other_event_kickoff')
    expect(getPlannedEngagementSection({ category: 'other', kind: null })).toBe('other_event_kickoff')
    expect(getPlannedEngagementSection({ category: 'other', kind: 'penalite' })).toBe('other_event_kickoff')
  })

  it('la matrice couvre toutes les catégories et tous les kinds réels sans exception', () => {
    const categories: EngagementCategory[] = ['frequency', 'quality', 'compliance', 'delivery', 'sla', 'reporting', 'other']
    const kinds: (EngagementKind | null)[] = ['objectif', 'obligation', 'livrable', 'controle', 'penalite', null]
    for (const category of categories) {
      for (const kind of kinds) {
        expect(PLANNED_ENGAGEMENT_SECTION_ORDER).toContain(getPlannedEngagementSection({ category, kind }))
      }
    }
  })
})

describe('groupPlannedEngagementsBySection — pas de perte, ordre stable', () => {
  it('44 Engagements réels (OCEF Compostage, audit NORM-1/NORM-2) → 44 répartis, aucune perte', () => {
    // Répartition vérifiée en base le 2026-09-25 : recurring=8, quality_control=6,
    // reporting_deliverables=8, safety_compliance=10, other_event_kickoff=12.
    const dataset: Array<{ category: EngagementCategory; kind: EngagementKind | null }> = [
      ...Array(8).fill({ category: 'frequency', kind: 'obligation' }),
      ...Array(6).fill({ category: 'quality', kind: 'controle' }),
      ...Array(8).fill({ category: 'reporting', kind: 'livrable' }),
      ...Array(10).fill({ category: 'compliance', kind: 'obligation' }),
      ...Array(12).fill({ category: 'other', kind: 'objectif' }),
    ]
    const engagements = dataset.map((d, i) => engagement({ id: `e${i}`, category: d.category, kind: d.kind }))

    const groups = groupPlannedEngagementsBySection(engagements)
    const total = groups.reduce((sum, g) => sum + g.engagements.length, 0)

    expect(total).toBe(44)
    expect(groups.find((g) => g.key === 'recurring')?.engagements.length).toBe(8)
    expect(groups.find((g) => g.key === 'quality_control')?.engagements.length).toBe(6)
    expect(groups.find((g) => g.key === 'reporting_deliverables')?.engagements.length).toBe(8)
    expect(groups.find((g) => g.key === 'safety_compliance')?.engagements.length).toBe(10)
    expect(groups.find((g) => g.key === 'other_event_kickoff')?.engagements.length).toBe(12)
  })

  it('chaque Engagement apparaît exactement une fois, jamais dupliqué ni fusionné', () => {
    const engagements = [
      engagement({ id: 'a', category: 'frequency', kind: 'obligation' }),
      engagement({ id: 'b', category: 'frequency', kind: 'obligation' }),
      engagement({ id: 'c', category: 'compliance', kind: 'controle' }),
    ]
    const groups = groupPlannedEngagementsBySection(engagements)
    const ids = groups.flatMap((g) => g.engagements.map((e) => e.id))

    expect(ids.sort()).toEqual(['a', 'b', 'c'])
  })

  it("l'ordre des sections retournées suit toujours PLANNED_ENGAGEMENT_SECTION_ORDER", () => {
    const engagements = [
      engagement({ id: 'a', category: 'other', kind: null }),
      engagement({ id: 'b', category: 'frequency', kind: 'obligation' }),
      engagement({ id: 'c', category: 'compliance', kind: 'obligation' }),
    ]
    const groups = groupPlannedEngagementsBySection(engagements)
    const keys = groups.map((g) => g.key)
    const expectedOrder = PLANNED_ENGAGEMENT_SECTION_ORDER.filter((k) => keys.includes(k))

    expect(keys).toEqual(expectedOrder)
  })

  it('sections vides omises (pas de section à 0 Engagement dans le résultat)', () => {
    const groups = groupPlannedEngagementsBySection([engagement({ id: 'a', category: 'frequency', kind: 'obligation' })])
    expect(groups).toHaveLength(1)
    expect(groups[0].key).toBe('recurring')
  })

  it('préserve la provenance (primaryProvenance et additionalProvenance) intacte', () => {
    const withProvenance = engagement({
      id: 'a',
      category: 'frequency',
      kind: 'obligation',
      primaryProvenance: {
        documentId: 'doc-1',
        documentFilename: 'CCTP.pdf',
        pageNumber: 5,
        excerpt: 'Nettoyer les filtres',
        frequencyRaw: 'Mensuel',
      },
      additionalProvenance: [
        { documentId: 'doc-2', documentFilename: 'CCAP.pdf', pageNumber: 2, excerpt: null, frequencyRaw: null },
      ],
    })
    const groups = groupPlannedEngagementsBySection([withProvenance])
    const result = groups[0].engagements[0]

    expect(result.primaryProvenance).toEqual(withProvenance.primaryProvenance)
    expect(result.additionalProvenance).toEqual(withProvenance.additionalProvenance)
  })
})

describe('getSectionHomogeneousStatus', () => {
  it('renvoie le statut commun quand tous les Engagements de la section le partagent', () => {
    const group = { engagements: [engagement({ id: 'a', status: 'active' }), engagement({ id: 'b', status: 'active' })] }
    expect(getSectionHomogeneousStatus(group)).toBe('active')
  })

  it('renvoie null quand la section mélange curated et active', () => {
    const group = { engagements: [engagement({ id: 'a', status: 'active' }), engagement({ id: 'b', status: 'curated' })] }
    expect(getSectionHomogeneousStatus(group)).toBeNull()
  })

  it('renvoie null pour une section vide', () => {
    expect(getSectionHomogeneousStatus({ engagements: [] })).toBeNull()
  })
})

// ENG-UX-1 LOT F (mandat Vincent 2026-09-26) — synthèse dérivée UNIQUEMENT des
// read-models LOT B/C, aucun nouveau calcul métier.
function testMission(overrides: Partial<EngagementMission> & { missionId: string }): EngagementMission {
  const input = {
    active: true,
    cadence: 'monthly' as const,
    lastInterventionDate: null as string | null,
    nextInterventionDate: null as string | null,
    openAnomalyCount: 0,
    assignedTeam: null,
    ...overrides,
  }
  return {
    missionId: overrides.missionId,
    missionName: overrides.missionName ?? 'Mission',
    cadence: input.cadence,
    active: input.active,
    assignedTeam: input.assignedTeam,
    lastInterventionDate: input.lastInterventionDate,
    nextInterventionDate: input.nextInterventionDate,
    openAnomalyCount: input.openAnomalyCount,
    hasActiveRhythm: overrides.hasActiveRhythm ?? false,
    health: buildMissionHealth(input, '2026-09-26'),
  }
}

function testAction(overrides: Partial<EngagementAction> & { actionId: string }): EngagementAction {
  return {
    actionId: overrides.actionId,
    title: overrides.title ?? 'Action',
    status: overrides.status ?? 'open',
    dueDate: overrides.dueDate ?? null,
    active: overrides.active ?? true,
    currentQualification: overrides.currentQualification ?? null,
  }
}

describe('computePlannedEngagementSynthesis — ENG-UX-1 LOT F', () => {
  it('total compte tous les Engagements, y compris curated', () => {
    const engagements = [
      engagement({ id: 'a', status: 'curated' }),
      engagement({ id: 'b', status: 'active' }),
    ]
    const result = computePlannedEngagementSynthesis(engagements, new Map(), new Map())
    expect(result.total).toBe(2)
    expect(result.withMission).toBe(0)
    expect(result.withoutMission).toBe(1) // seul 'b' est actif ; 'a' (curated) n'est jamais compté
    expect(result.needsPlanning).toBe(1)
  })

  it('un Engagement curated ne compte jamais dans withMission/withoutMission/needsPlanning', () => {
    const engagements = [engagement({ id: 'a', status: 'curated' })]
    const result = computePlannedEngagementSynthesis(engagements, new Map(), new Map())
    expect(result.withMission).toBe(0)
    expect(result.withoutMission).toBe(0)
    expect(result.needsPlanning).toBe(0)
  })

  it('actif avec une Mission ayant une prochaine occurrence : withMission=1, needsPlanning=0', () => {
    const engagements = [engagement({ id: 'a', status: 'active' })]
    const missionsByEngagement = new Map([['a', [testMission({ missionId: 'm1', nextInterventionDate: '2026-10-01' })]]])
    const result = computePlannedEngagementSynthesis(engagements, missionsByEngagement, new Map())
    expect(result.withMission).toBe(1)
    expect(result.withoutMission).toBe(0)
    expect(result.needsPlanning).toBe(0)
  })

  it('actif avec une Mission SANS prochaine occurrence : withMission=1 mais needsPlanning=1', () => {
    const engagements = [engagement({ id: 'a', status: 'active' })]
    const missionsByEngagement = new Map([['a', [testMission({ missionId: 'm1', nextInterventionDate: null })]]])
    const result = computePlannedEngagementSynthesis(engagements, missionsByEngagement, new Map())
    expect(result.withMission).toBe(1)
    expect(result.withoutMission).toBe(0)
    expect(result.needsPlanning).toBe(1)
  })

  it('actif sans aucune Mission : withoutMission=1 et needsPlanning=1', () => {
    const engagements = [engagement({ id: 'a', status: 'active' })]
    const result = computePlannedEngagementSynthesis(engagements, new Map(), new Map())
    expect(result.withMission).toBe(0)
    expect(result.withoutMission).toBe(1)
    expect(result.needsPlanning).toBe(1)
  })

  it('plusieurs Missions, une seule avec prochaine occurrence : needsPlanning=0 (au moins une organisée)', () => {
    const engagements = [engagement({ id: 'a', status: 'active' })]
    const missionsByEngagement = new Map([['a', [
      testMission({ missionId: 'm1', nextInterventionDate: null }),
      testMission({ missionId: 'm2', nextInterventionDate: '2026-11-01' }),
    ]]])
    const result = computePlannedEngagementSynthesis(engagements, missionsByEngagement, new Map())
    expect(result.needsPlanning).toBe(0)
  })

  it('actions ouvertes dédupliquées : une Action liée à 2 Engagements ne compte qu’une fois', () => {
    const engagements = [engagement({ id: 'a', status: 'active' }), engagement({ id: 'b', status: 'active' })]
    const actionsByEngagement = new Map([
      ['a', [testAction({ actionId: 'act-1' })]],
      ['b', [testAction({ actionId: 'act-1' })]],
    ])
    const result = computePlannedEngagementSynthesis(engagements, new Map(), actionsByEngagement)
    expect(result.openActionsCount).toBe(1)
  })

  it('une Action done (active=false) n’est jamais comptée dans openActionsCount', () => {
    const engagements = [engagement({ id: 'a', status: 'active' })]
    const actionsByEngagement = new Map([['a', [testAction({ actionId: 'act-1', status: 'done', active: false })]]])
    const result = computePlannedEngagementSynthesis(engagements, new Map(), actionsByEngagement)
    expect(result.openActionsCount).toBe(0)
  })

  // ENG-UX-1 MICRO-FIX (mandat Vincent 2026-09-26) — une Mission inactive est
  // de l'historique, jamais une organisation actuelle.
  it('actif avec une seule Mission INACTIVE : withoutMission=1 et needsPlanning=1 (l’inactive ignorée)', () => {
    const engagements = [engagement({ id: 'a', status: 'active' })]
    const missionsByEngagement = new Map([['a', [testMission({ missionId: 'm1', active: false, nextInterventionDate: '2026-10-01' })]]])
    const result = computePlannedEngagementSynthesis(engagements, missionsByEngagement, new Map())
    expect(result.withMission).toBe(0)
    expect(result.withoutMission).toBe(1)
    expect(result.needsPlanning).toBe(1)
  })

  it('Mission inactive + Mission active organisée : withMission=1, needsPlanning=0 (l’inactive n’en bloque pas la comptabilisation)', () => {
    const engagements = [engagement({ id: 'a', status: 'active' })]
    const missionsByEngagement = new Map([['a', [
      testMission({ missionId: 'm1', active: false, nextInterventionDate: null }),
      testMission({ missionId: 'm2', active: true, nextInterventionDate: '2026-11-01' }),
    ]]])
    const result = computePlannedEngagementSynthesis(engagements, missionsByEngagement, new Map())
    expect(result.withMission).toBe(1)
    expect(result.withoutMission).toBe(0)
    expect(result.needsPlanning).toBe(0)
  })

  it('curatedCount et activeCount reflètent status, indépendamment de withMission/withoutMission', () => {
    const engagements = [
      engagement({ id: 'a', status: 'curated' }),
      engagement({ id: 'b', status: 'curated' }),
      engagement({ id: 'c', status: 'active' }),
    ]
    const result = computePlannedEngagementSynthesis(engagements, new Map(), new Map())
    expect(result.curatedCount).toBe(2)
    expect(result.activeCount).toBe(1)
    expect(result.total).toBe(3)
  })
})

// PLAN-UX-1D (mandat Vincent 2026-09-27) — onglets/filtres de pilotage.
describe('plannedEngagementMatchesTab', () => {
  it("'all' matche tout, quel que soit le statut", () => {
    expect(plannedEngagementMatchesTab('all', engagement({ id: 'a', status: 'curated' }), [], [])).toBe(true)
    expect(plannedEngagementMatchesTab('all', engagement({ id: 'a', status: 'active' }), [], [])).toBe(true)
  })

  it("'to_activate' matche uniquement les curated", () => {
    expect(plannedEngagementMatchesTab('to_activate', engagement({ id: 'a', status: 'curated' }), [], [])).toBe(true)
    expect(plannedEngagementMatchesTab('to_activate', engagement({ id: 'a', status: 'active' }), [], [])).toBe(false)
  })

  it("'with_open_action' matche dès qu'une Action liée est active, quel que soit le statut de l'Engagement", () => {
    const actions = [testAction({ actionId: 'act-1', active: true })]
    expect(plannedEngagementMatchesTab('with_open_action', engagement({ id: 'a', status: 'curated' }), [], actions)).toBe(true)
    expect(plannedEngagementMatchesTab('with_open_action', engagement({ id: 'a', status: 'active' }), [], actions)).toBe(true)
    const closedActions = [testAction({ actionId: 'act-1', active: false })]
    expect(plannedEngagementMatchesTab('with_open_action', engagement({ id: 'a', status: 'active' }), [], closedActions)).toBe(false)
  })

  it("'to_organize' matche un Engagement actif sans aucune Mission active", () => {
    const active = engagement({ id: 'a', status: 'active' })
    expect(plannedEngagementMatchesTab('to_organize', active, [], [])).toBe(true)
    const inactiveOnly = [testMission({ missionId: 'm1', active: false })]
    expect(plannedEngagementMatchesTab('to_organize', active, inactiveOnly, [])).toBe(true)
    const activeMission = [testMission({ missionId: 'm1', active: true })]
    expect(plannedEngagementMatchesTab('to_organize', active, activeMission, [])).toBe(false)
    expect(plannedEngagementMatchesTab('to_organize', engagement({ id: 'a', status: 'curated' }), [], [])).toBe(false)
  })

  it("'to_plan' matche un Engagement actif dont aucune Mission active n'a de prochaine occurrence", () => {
    const active = engagement({ id: 'a', status: 'active' })
    const noUpcoming = [testMission({ missionId: 'm1', active: true, nextInterventionDate: null })]
    expect(plannedEngagementMatchesTab('to_plan', active, noUpcoming, [])).toBe(true)
    const upcoming = [testMission({ missionId: 'm1', active: true, nextInterventionDate: '2026-11-01' })]
    expect(plannedEngagementMatchesTab('to_plan', active, upcoming, [])).toBe(false)
    expect(plannedEngagementMatchesTab('to_plan', active, [], [])).toBe(true)
  })
})

describe('computePlannedEngagementTabCounts', () => {
  it('compte chaque Engagement dans tous les onglets où il matche', () => {
    const engagements = [
      engagement({ id: 'a', status: 'curated' }),
      engagement({ id: 'b', status: 'active' }),
      engagement({ id: 'c', status: 'active' }),
    ]
    const missionsByEngagement = new Map([
      ['b', [testMission({ missionId: 'm1', active: true, nextInterventionDate: '2026-11-01' })]],
    ])
    const actionsByEngagement = new Map([
      ['c', [testAction({ actionId: 'act-1', active: true })]],
    ])
    const counts = computePlannedEngagementTabCounts(engagements, missionsByEngagement, actionsByEngagement)
    expect(counts.all).toBe(3)
    expect(counts.to_activate).toBe(1) // a
    expect(counts.to_organize).toBe(1) // c (aucune Mission)
    expect(counts.to_plan).toBe(1) // c (idem, aucune Mission organisée)
    expect(counts.with_open_action).toBe(1) // c
  })
})

describe('filterPlannedEngagements', () => {
  const dataset = [
    engagement({
      id: 'a',
      status: 'curated',
      kind: 'controle',
      category: 'quality',
      shortLabel: 'Essai plaque',
      primaryProvenance: { documentId: 'doc-1', documentFilename: 'CCTP.pdf', pageNumber: 1, excerpt: null, frequencyRaw: null },
    }),
    engagement({
      id: 'b',
      status: 'active',
      kind: 'livrable',
      category: 'reporting',
      shortLabel: 'DOE',
      primaryProvenance: { documentId: null, documentFilename: null, pageNumber: null, excerpt: null, frequencyRaw: null },
    }),
  ]

  it('filtre par tab', () => {
    const result = filterPlannedEngagements(dataset, new Map(), new Map(), { tab: 'to_activate' })
    expect(result.map((e) => e.id)).toEqual(['a'])
  })

  it('filtre par kind', () => {
    const result = filterPlannedEngagements(dataset, new Map(), new Map(), { kind: 'livrable' })
    expect(result.map((e) => e.id)).toEqual(['b'])
  })

  it('filtre par kind=null (sentinel « Non typé »)', () => {
    const withUntyped = [...dataset, engagement({ id: 'c', kind: null })]
    const result = filterPlannedEngagements(withUntyped, new Map(), new Map(), { kind: null })
    expect(result.map((e) => e.id)).toEqual(['c'])
  })

  it('filtre par category', () => {
    const result = filterPlannedEngagements(dataset, new Map(), new Map(), { category: 'reporting' })
    expect(result.map((e) => e.id)).toEqual(['b'])
  })

  it('filtre par provenance manuelle vs document', () => {
    expect(filterPlannedEngagements(dataset, new Map(), new Map(), { provenance: 'document' }).map((e) => e.id)).toEqual(['a'])
    expect(filterPlannedEngagements(dataset, new Map(), new Map(), { provenance: 'manual' }).map((e) => e.id)).toEqual(['b'])
  })

  it('filtre par document source (nom de fichier)', () => {
    const result = filterPlannedEngagements(dataset, new Map(), new Map(), { documentFilename: 'CCTP.pdf' })
    expect(result.map((e) => e.id)).toEqual(['a'])
  })

  it('filtre par recherche texte (insensible à la casse) sur shortLabel', () => {
    const result = filterPlannedEngagements(dataset, new Map(), new Map(), { search: 'doe' })
    expect(result.map((e) => e.id)).toEqual(['b'])
  })

  it('combine plusieurs filtres (ET logique)', () => {
    const result = filterPlannedEngagements(dataset, new Map(), new Map(), { category: 'quality', kind: 'controle' })
    expect(result.map((e) => e.id)).toEqual(['a'])
  })
})
