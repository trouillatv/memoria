// DOC-CONTRACT-OS-1B4-C1 (mandat §15) — résolution READ-ONLY des cibles
// Planning : jamais de sélection automatique, une liste explicite de
// candidats avec leur statut de préparation (ready/blocked_*) et raison.

import { describe, it, expect } from 'vitest'
import { resolvePlanningTargetCandidates, type ResolvableMission } from '@/lib/planning/target-resolution'

function mission(overrides: Partial<ResolvableMission> = {}): ResolvableMission {
  return {
    missionId: 'mission-1',
    missionName: 'Mission 1',
    active: true,
    activeSimpleTemplateIds: [],
    activePublishedCycleIds: [],
    ...overrides,
  }
}

describe('resolvePlanningTargetCandidates — mission inactive', () => {
  it('bloque quel que soit mutationKind, avec reason=mission_inactive', () => {
    for (const mutationKind of ['new', 'modify', 'suspend'] as const) {
      const [candidate] = resolvePlanningTargetCandidates({
        mutationKind,
        candidateMissions: [mission({ active: false })],
      })
      expect(candidate.readiness).toBe('blocked_no_target')
      expect(candidate.reason).toBe('mission_inactive')
    }
  })
})

describe('resolvePlanningTargetCandidates — mutationKind=new', () => {
  it('ready quand aucune source active', () => {
    const [candidate] = resolvePlanningTargetCandidates({
      mutationKind: 'new',
      candidateMissions: [mission()],
    })
    expect(candidate).toMatchObject({ readiness: 'ready', sourceKind: null })
  })

  it('bloqué (conflit) si un cycle publié existe déjà — un par cycle', () => {
    const candidates = resolvePlanningTargetCandidates({
      mutationKind: 'new',
      candidateMissions: [mission({ activePublishedCycleIds: ['cycle-1', 'cycle-2'] })],
    })
    expect(candidates).toHaveLength(2)
    for (const c of candidates) {
      expect(c.readiness).toBe('blocked_conflicting_source')
      expect(c.reason).toBe('active_published_cycle_conflict')
      expect(c.sourceKind).toBe('cycle')
    }
  })

  it('ready même si un rythme SIMPLE actif existe (NEW ne concerne pas SIMPLE)', () => {
    const [candidate] = resolvePlanningTargetCandidates({
      mutationKind: 'new',
      candidateMissions: [mission({ activeSimpleTemplateIds: ['template-1'] })],
    })
    expect(candidate.readiness).toBe('ready')
  })
})

describe('resolvePlanningTargetCandidates — mutationKind=modify', () => {
  it('blocked_no_target/no_active_source si aucune source', () => {
    const [candidate] = resolvePlanningTargetCandidates({
      mutationKind: 'modify',
      candidateMissions: [mission()],
    })
    expect(candidate).toMatchObject({ readiness: 'blocked_no_target', reason: 'no_active_source' })
  })

  it('SIMPLE reste bloqué (blocked_requires_simple_supersession) — point gelé Vincent', () => {
    const [candidate] = resolvePlanningTargetCandidates({
      mutationKind: 'modify',
      candidateMissions: [mission({ activeSimpleTemplateIds: ['template-1'] })],
    })
    expect(candidate).toMatchObject({
      sourceKind: 'simple',
      templateId: 'template-1',
      readiness: 'blocked_requires_simple_supersession',
      reason: 'simple_modify_requires_supersession',
    })
  })

  it('cycle publié est ready', () => {
    const [candidate] = resolvePlanningTargetCandidates({
      mutationKind: 'modify',
      candidateMissions: [mission({ activePublishedCycleIds: ['cycle-1'] })],
    })
    expect(candidate).toMatchObject({ sourceKind: 'cycle', cycleId: 'cycle-1', readiness: 'ready' })
  })
})

describe('resolvePlanningTargetCandidates — mutationKind=suspend', () => {
  it('blocked_no_target/no_active_source si aucune source', () => {
    const [candidate] = resolvePlanningTargetCandidates({
      mutationKind: 'suspend',
      candidateMissions: [mission()],
    })
    expect(candidate).toMatchObject({ readiness: 'blocked_no_target', reason: 'no_active_source' })
  })

  it('SIMPLE est ready pour suspend (contrairement à modify)', () => {
    const [candidate] = resolvePlanningTargetCandidates({
      mutationKind: 'suspend',
      candidateMissions: [mission({ activeSimpleTemplateIds: ['template-1'] })],
    })
    expect(candidate).toMatchObject({ sourceKind: 'simple', readiness: 'ready', reason: undefined })
  })

  it('cycle publié est ready', () => {
    const [candidate] = resolvePlanningTargetCandidates({
      mutationKind: 'suspend',
      candidateMissions: [mission({ activePublishedCycleIds: ['cycle-1'] })],
    })
    expect(candidate).toMatchObject({ sourceKind: 'cycle', readiness: 'ready' })
  })
})

describe('resolvePlanningTargetCandidates — plusieurs Missions candidates', () => {
  it('résout chaque Mission indépendamment, jamais une sélection unique', () => {
    const candidates = resolvePlanningTargetCandidates({
      mutationKind: 'suspend',
      candidateMissions: [
        mission({ missionId: 'm1', activeSimpleTemplateIds: ['t1'] }),
        mission({ missionId: 'm2', active: false }),
        mission({ missionId: 'm3', activePublishedCycleIds: ['c1'] }),
      ],
    })
    expect(candidates.map((c) => c.missionId)).toEqual(['m1', 'm2', 'm3'])
    expect(candidates.map((c) => c.readiness)).toEqual(['ready', 'blocked_no_target', 'ready'])
  })
})
