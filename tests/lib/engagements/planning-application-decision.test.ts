// DOC-CONTRACT-OS-1B4-C1 (mandat §15) — modèle pur : empreinte d'application
// (indépendance de l'ordre des clés, sensibilité à tout changement de
// décision) et fraîcheur contractuelle (current/stale/dismissed).

import { describe, it, expect } from 'vitest'
import {
  computeApplicationFingerprint,
  computeContractFreshness,
  normalizeDecisionAgainstProposal,
  computeSuspensionWindow,
  coversDate,
  overlapsPeriod,
  validateTargetEligibility,
  type ApplicationFingerprintInput,
  type NewDecisionPayload,
  type ModifyCycleDecisionPayload,
  type ModifySimpleBlockedDecisionPayload,
  type SuspendDecisionPayload,
} from '@/lib/engagements/planning-application-decision'
import type {
  NewPlanningImpactPayload,
  ModifyFrequencyPlanningImpactPayload,
  SuspendPlanningImpactPayload,
} from '@/lib/engagements/planning-impact-proposal'

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

describe('normalizeDecisionAgainstProposal (mandat ROUND 2 FIX 1)', () => {
  const newProposal: NewPlanningImpactPayload = {
    operation: 'new',
    temporality: 'permanent',
    effectiveFrom: '2026-11-01',
    effectiveTo: '2026-12-31',
    scopeKey: 'frequency',
    cadence: { count: 1, period: 'week' },
  }

  it('NEW — canonicalise startsOn/endsOn depuis le contrat, jamais depuis le draft humain', () => {
    const result = normalizeDecisionAgainstProposal(baseDraft, newProposal)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const payload = result.payload as NewDecisionPayload
    expect(payload.draftSimpleTemplate.startsOn).toBe('2026-11-01')
    expect(payload.draftSimpleTemplate.endsOn).toBe('2026-12-31')
  })

  it('NEW — rejette un draftSimpleTemplate.missionId incohérent avec targetMissionId', () => {
    const forged: NewDecisionPayload = {
      ...baseDraft,
      draftSimpleTemplate: { ...baseDraft.draftSimpleTemplate, missionId: 'mission-2' },
    }
    const result = normalizeDecisionAgainstProposal(forged, newProposal)
    expect(result).toEqual({ ok: false, error: 'target_mission_mismatch' })
  })

  const modifyProposal: ModifyFrequencyPlanningImpactPayload = {
    operation: 'change_frequency',
    scopeKey: 'frequency',
    effectiveFrom: '2026-11-15',
    effectiveTo: null,
    fromCadence: { count: 1, period: 'week' },
    toCadence: { count: 2, period: 'week' },
  }

  const baseModifyCycle: ModifyCycleDecisionPayload = {
    mutationKind: 'modify',
    targetMissionId: 'mission-1',
    targetSourceKind: 'cycle',
    targetTemplateId: null,
    targetCycleId: 'cycle-1',
    draftCycleAfter: {
      missionId: 'mission-1',
      cycleLengthWeeks: 2,
      anchorDate: '2026-10-01',
      startsOn: '2026-10-01',
      endsOn: '2026-10-31',
      slots: [],
    },
  }

  it('MODIFY+cycle — canonicalise startsOn/endsOn de draftCycleAfter depuis le contrat', () => {
    const result = normalizeDecisionAgainstProposal(baseModifyCycle, modifyProposal)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const payload = result.payload as ModifyCycleDecisionPayload
    expect(payload.draftCycleAfter.startsOn).toBe('2026-11-15')
    expect(payload.draftCycleAfter.endsOn).toBeNull()
  })

  it('MODIFY+cycle — rejette un draftCycleAfter.missionId incohérent avec targetMissionId', () => {
    const forged: ModifyCycleDecisionPayload = {
      ...baseModifyCycle,
      draftCycleAfter: { ...baseModifyCycle.draftCycleAfter, missionId: 'mission-9' },
    }
    const result = normalizeDecisionAgainstProposal(forged, modifyProposal)
    expect(result).toEqual({ ok: false, error: 'target_mission_mismatch' })
  })

  it('MODIFY+simple bloqué et SUSPEND — passthrough, aucune canonicalisation appliquée', () => {
    const blocked: ModifySimpleBlockedDecisionPayload = {
      mutationKind: 'modify',
      targetMissionId: 'mission-1',
      targetSourceKind: 'simple',
      targetTemplateId: 'template-1',
      targetCycleId: null,
    }
    expect(normalizeDecisionAgainstProposal(blocked, modifyProposal)).toEqual({ ok: true, payload: blocked })

    const suspend: SuspendDecisionPayload = {
      mutationKind: 'suspend',
      targetMissionId: 'mission-1',
      targetSourceKind: 'cycle',
      targetTemplateId: null,
      targetCycleId: 'cycle-1',
    }
    const suspendProposal: SuspendPlanningImpactPayload = {
      operation: 'suspend',
      effectiveFrom: '2026-10-10',
      effectiveTo: '2026-10-14',
      resumeOn: null,
      priorCadence: { count: 1, period: 'week' },
    }
    expect(normalizeDecisionAgainstProposal(suspend, suspendProposal)).toEqual({ ok: true, payload: suspend })
  })
})

describe('computeSuspensionWindow (mandat ROUND 2 FIX 1)', () => {
  it("la fenêtre suspendue vient EXCLUSIVEMENT du contrat, jamais de la fenêtre d'affichage", () => {
    const proposal: SuspendPlanningImpactPayload = {
      operation: 'suspend',
      effectiveFrom: '2026-10-10',
      effectiveTo: '2026-10-14',
      resumeOn: null,
      priorCadence: { count: 1, period: 'week' },
    }
    expect(computeSuspensionWindow(proposal, '2026-10-01', '2026-10-31')).toEqual({ from: '2026-10-10', to: '2026-10-14' })
  })

  it("retourne null quand la fenêtre contractuelle et la fenêtre d'affichage ne se recoupent pas", () => {
    const proposal: SuspendPlanningImpactPayload = {
      operation: 'suspend',
      effectiveFrom: '2026-11-01',
      effectiveTo: '2026-11-30',
      resumeOn: null,
      priorCadence: { count: 1, period: 'week' },
    }
    expect(computeSuspensionWindow(proposal, '2026-10-01', '2026-10-31')).toBeNull()
  })

  it('utilise resumeOn comme borne de fin contractuelle quand effectiveTo est null', () => {
    const proposal: SuspendPlanningImpactPayload = {
      operation: 'suspend',
      effectiveFrom: '2026-10-10',
      effectiveTo: null,
      resumeOn: '2026-10-20',
      priorCadence: { count: 1, period: 'week' },
    }
    expect(computeSuspensionWindow(proposal, '2026-10-01', '2026-10-31')).toEqual({ from: '2026-10-10', to: '2026-10-20' })
  })
})

describe('coversDate', () => {
  it("une date d'effet null est toujours couverte", () => {
    expect(coversDate('2026-01-01', '2026-12-31', null)).toBe(true)
  })

  it('couvre une date strictement comprise entre startsOn et endsOn', () => {
    expect(coversDate('2026-01-01', '2026-12-31', '2026-06-15')).toBe(true)
  })

  it('ne couvre pas une date antérieure à startsOn', () => {
    expect(coversDate('2026-06-01', '2026-12-31', '2026-01-01')).toBe(false)
  })

  it('ne couvre pas une date postérieure à endsOn', () => {
    expect(coversDate('2026-01-01', '2026-06-01', '2026-12-31')).toBe(false)
  })

  it('endsOn null = borne ouverte, couvre toute date postérieure à startsOn', () => {
    expect(coversDate('2026-01-01', null, '2030-01-01')).toBe(true)
  })
})

describe('overlapsPeriod (mandat ROUND 2 FIX 2 — conflit temporel NEW)', () => {
  it('un cycle qui se termine avant le NEW ne provoque aucun conflit', () => {
    expect(overlapsPeriod('2026-01-01', '2026-01-31', '2026-03-01', '2026-03-31')).toBe(false)
  })

  it("un cycle qui couvre effectiveFrom provoque un conflit", () => {
    expect(overlapsPeriod('2026-02-01', '2026-04-30', '2026-03-01', '2026-03-31')).toBe(true)
  })

  it('un cycle qui démarre au milieu de la période NEW provoque un conflit', () => {
    expect(overlapsPeriod('2026-03-15', '2026-06-30', '2026-03-01', '2026-03-31')).toBe(true)
  })

  it('un cycle qui démarre après effectiveTo ne provoque aucun conflit', () => {
    expect(overlapsPeriod('2026-04-01', '2026-04-30', '2026-03-01', '2026-03-31')).toBe(false)
  })

  it('NEW sans effectiveTo (borne ouverte) — un cycle futur postérieur à effectiveFrom provoque un conflit', () => {
    expect(overlapsPeriod('2027-01-01', null, '2026-03-01', null)).toBe(true)
  })
})

describe('validateTargetEligibility (mandat ROUND 2 FIX 3)', () => {
  it('mission inactive rend toujours la cible inéligible, quel que soit mutationKind', () => {
    expect(
      validateTargetEligibility({
        mutationKind: 'new',
        targetSourceKind: null,
        engagementId: 'engagement-1',
        effectiveFrom: '2026-03-01',
        effectiveTo: '2026-03-31',
        mission: { active: false, engagementIds: ['engagement-1'] },
        newMissionCycles: [],
      }),
    ).toBe(false)
  })

  it('NEW — un cycle Mission existant qui chevauche la période demandée rend la cible inéligible', () => {
    expect(
      validateTargetEligibility({
        mutationKind: 'new',
        targetSourceKind: null,
        engagementId: 'engagement-1',
        effectiveFrom: '2026-03-01',
        effectiveTo: '2026-03-31',
        mission: { active: true, engagementIds: null },
        newMissionCycles: [{ startsOn: '2026-02-01', endsOn: '2026-04-30' }],
      }),
    ).toBe(false)
  })

  it('NEW — aucun chevauchement avec les cycles existants rend la cible éligible', () => {
    expect(
      validateTargetEligibility({
        mutationKind: 'new',
        targetSourceKind: null,
        engagementId: 'engagement-1',
        effectiveFrom: '2026-03-01',
        effectiveTo: '2026-03-31',
        mission: { active: true, engagementIds: null },
        newMissionCycles: [{ startsOn: '2025-01-01', endsOn: '2025-12-31' }],
      }),
    ).toBe(true)
  })

  it('MODIFY/SUSPEND — engagementId absent de mission.engagementIds rend la cible inéligible (cible forgée)', () => {
    const forgedBase = {
      engagementId: 'engagement-forged',
      effectiveFrom: '2026-03-01',
      effectiveTo: null,
      mission: { active: true, engagementIds: ['engagement-1'] },
      publishedCycle: { status: 'published', startsOn: '2026-01-01', endsOn: null },
    }
    expect(validateTargetEligibility({ mutationKind: 'modify', targetSourceKind: 'cycle', ...forgedBase })).toBe(false)
    expect(validateTargetEligibility({ mutationKind: 'suspend', targetSourceKind: 'cycle', ...forgedBase })).toBe(false)
  })

  it('SIMPLE inactif rend la cible inéligible', () => {
    expect(
      validateTargetEligibility({
        mutationKind: 'suspend',
        targetSourceKind: 'simple',
        engagementId: 'engagement-1',
        effectiveFrom: '2026-03-01',
        effectiveTo: null,
        mission: { active: true, engagementIds: ['engagement-1'] },
        simpleTemplate: { active: false, startsOn: '2026-01-01', endsOn: null },
      }),
    ).toBe(false)
  })

  it('SIMPLE actif mais ne couvrant pas effectiveFrom rend la cible inéligible', () => {
    expect(
      validateTargetEligibility({
        mutationKind: 'suspend',
        targetSourceKind: 'simple',
        engagementId: 'engagement-1',
        effectiveFrom: '2026-03-01',
        effectiveTo: null,
        mission: { active: true, engagementIds: ['engagement-1'] },
        simpleTemplate: { active: true, startsOn: '2026-04-01', endsOn: null },
      }),
    ).toBe(false)
  })

  it('cycle non publié rend la cible inéligible', () => {
    expect(
      validateTargetEligibility({
        mutationKind: 'modify',
        targetSourceKind: 'cycle',
        engagementId: 'engagement-1',
        effectiveFrom: '2026-03-01',
        effectiveTo: null,
        mission: { active: true, engagementIds: ['engagement-1'] },
        publishedCycle: { status: 'draft', startsOn: '2026-01-01', endsOn: null },
      }),
    ).toBe(false)
  })

  it('cycle publié mais ne couvrant pas effectiveFrom rend la cible inéligible', () => {
    expect(
      validateTargetEligibility({
        mutationKind: 'modify',
        targetSourceKind: 'cycle',
        engagementId: 'engagement-1',
        effectiveFrom: '2026-03-01',
        effectiveTo: null,
        mission: { active: true, engagementIds: ['engagement-1'] },
        publishedCycle: { status: 'published', startsOn: '2026-04-01', endsOn: null },
      }),
    ).toBe(false)
  })
})
