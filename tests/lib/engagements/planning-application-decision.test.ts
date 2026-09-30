// DOC-CONTRACT-OS-1B4-C1 (mandat §15) — modèle pur : empreinte d'application
// (indépendance de l'ordre des clés, sensibilité à tout changement de
// décision) et fraîcheur contractuelle (current/stale/dismissed).

import { describe, it, expect } from 'vitest'
import {
  computeApplicationFingerprint,
  computeContractFreshness,
  type ApplicationFingerprintInput,
  type NewDecisionPayload,
} from '@/lib/engagements/planning-application-decision'

const baseDraft: NewDecisionPayload = {
  mutationKind: 'new',
  targetMissionId: 'mission-1',
  targetSourceKind: null,
  targetTemplateId: null,
  targetCycleId: null,
  draftSimpleTemplate: {
    missionId: 'mission-1',
    frequency: 'weekly',
    slots: null,
    dayOfWeek: 1,
    dayOfMonth: null,
    plannedStartHHMM: '08:00',
    plannedEndHHMM: '10:00',
    startsOn: '2026-10-01',
    endsOn: null,
  },
}

function baseInput(overrides: Partial<ApplicationFingerprintInput> = {}): ApplicationFingerprintInput {
  return {
    contractEffectId: 'effect-1',
    planningImpactProposalId: 'proposal-1',
    proposalVersionAtDecision: 1,
    mutationKind: 'new',
    targetMissionId: 'mission-1',
    targetSourceKind: null,
    targetTemplateId: null,
    targetCycleId: null,
    decisionPayload: baseDraft,
    ...overrides,
  }
}

describe('computeApplicationFingerprint', () => {
  it("est indépendant de l'ordre des clés (canonicalStringify)", () => {
    const a = computeApplicationFingerprint(baseInput())
    const reordered: ApplicationFingerprintInput = {
      mutationKind: 'new',
      targetMissionId: 'mission-1',
      contractEffectId: 'effect-1',
      targetCycleId: null,
      planningImpactProposalId: 'proposal-1',
      targetTemplateId: null,
      proposalVersionAtDecision: 1,
      targetSourceKind: null,
      decisionPayload: baseDraft,
    }
    const b = computeApplicationFingerprint(reordered)
    expect(b).toBe(a)
  })

  it('est déterministe pour la même entrée', () => {
    expect(computeApplicationFingerprint(baseInput())).toBe(computeApplicationFingerprint(baseInput()))
  })

  it('change si la cible (targetMissionId) change', () => {
    const a = computeApplicationFingerprint(baseInput())
    const b = computeApplicationFingerprint(baseInput({ targetMissionId: 'mission-2' }))
    expect(b).not.toBe(a)
  })

  it("change si le contenu du decisionPayload change (ex. jour de la semaine du draft)", () => {
    const a = computeApplicationFingerprint(baseInput())
    const changed: NewDecisionPayload = { ...baseDraft, draftSimpleTemplate: { ...baseDraft.draftSimpleTemplate, dayOfWeek: 2 } }
    const b = computeApplicationFingerprint(baseInput({ decisionPayload: changed }))
    expect(b).not.toBe(a)
  })

  it('change si proposalVersionAtDecision change (même cible, autre version contractuelle)', () => {
    const a = computeApplicationFingerprint(baseInput())
    const b = computeApplicationFingerprint(baseInput({ proposalVersionAtDecision: 2 }))
    expect(b).not.toBe(a)
  })

  it('change si mutationKind change', () => {
    const a = computeApplicationFingerprint(baseInput())
    const b = computeApplicationFingerprint(baseInput({ mutationKind: 'suspend' }))
    expect(b).not.toBe(a)
  })
})

describe('computeContractFreshness', () => {
  it('current — même version, proposition toujours proposed', () => {
    expect(
      computeContractFreshness({ proposalVersionAtDecision: 3, currentProposalVersion: 3, currentProposalStatus: 'proposed' }),
    ).toBe('current')
  })

  it('stale — la proposition a changé de version depuis la décision', () => {
    expect(
      computeContractFreshness({ proposalVersionAtDecision: 1, currentProposalVersion: 2, currentProposalStatus: 'proposed' }),
    ).toBe('stale')
  })

  it('dismissed — la proposition a été écartée, prioritaire même si la version est inchangée', () => {
    expect(
      computeContractFreshness({ proposalVersionAtDecision: 1, currentProposalVersion: 1, currentProposalStatus: 'dismissed' }),
    ).toBe('dismissed')
  })

  it('dismissed prime sur stale (une proposition dismissed et version différente reste dismissed)', () => {
    expect(
      computeContractFreshness({ proposalVersionAtDecision: 1, currentProposalVersion: 5, currentProposalStatus: 'dismissed' }),
    ).toBe('dismissed')
  })
})
