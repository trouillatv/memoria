// DOC-CONTRACT-OS-1B4-B (mandat Vincent 2026-09-30) — tests purs du moteur de
// construction des Propositions d'impact Planning (lib/engagements/
// planning-impact-proposal.ts). Aucun accès DB : reflète la discipline de
// resolve-contract-state.test.ts.

import { describe, it, expect } from 'vitest'
import {
  buildPlanningImpactProposalPayload,
  computePlanningImpactProposalFingerprint,
  resolvePlanningApplicationCapability,
  type NewPlanningImpactPayload,
} from '@/lib/engagements/planning-impact-proposal'
import type { EngagementContractEffectRow, MaterializedContractEffect } from '@/lib/engagements/resolve-contract-state'
import type { ContractTemporality } from '@/lib/engagements/contract-effect'

function row(
  overrides: Partial<EngagementContractEffectRow> & { id: string; effect: MaterializedContractEffect },
): EngagementContractEffectRow {
  return {
    engagementId: 'eng-1',
    temporality: 'permanent' as ContractTemporality,
    scopeKey: 'whole_engagement',
    effectPayload: {},
    startsOn: null,
    endsOn: null,
    resumeOn: null,
    sourceDocumentId: 'doc-1',
    sourceProposalId: 'prop-1',
    appliedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('buildPlanningImpactProposalPayload', () => {
  it('NEW — reprend temporalité + bornes, jamais de donnée Planning', () => {
    const effect = row({ id: 'e-new', effect: 'new', temporality: 'bounded', startsOn: '2026-10-01', endsOn: '2026-12-31' })
    const payload = buildPlanningImpactProposalPayload(effect)
    expect(payload).toEqual({
      operation: 'new',
      temporality: 'bounded',
      effectiveFrom: '2026-10-01',
      effectiveTo: '2026-12-31',
    })
  })

  it('MODIFY — operation générique change_<scopeKey>, from/to portés par l\'appelant', () => {
    const effect = row({
      id: 'e-mod',
      effect: 'modify',
      scopeKey: 'frequency',
      startsOn: '2026-12-01',
      endsOn: null,
      effectPayload: { frequency: 'weekly' },
    })
    const payload = buildPlanningImpactProposalPayload(effect, { frequency: 'monthly' })
    expect(payload).toEqual({
      operation: 'change_frequency',
      scopeKey: 'frequency',
      effectiveFrom: '2026-12-01',
      effectiveTo: null,
      from: { frequency: 'monthly' },
      to: { frequency: 'weekly' },
    })
  })

  it('MODIFY — sans priorScopeValue fourni, from vaut null', () => {
    const effect = row({ id: 'e-mod-2', effect: 'modify', scopeKey: 'lot_a', startsOn: '2026-11-01', effectPayload: { price: 10 } })
    const payload = buildPlanningImpactProposalPayload(effect)
    expect(payload).toMatchObject({ from: null, to: { price: 10 } })
  })

  it('SUSPEND — reprend effectiveFrom/effectiveTo/resumeOn', () => {
    const effect = row({ id: 'e-susp', effect: 'suspend', startsOn: '2026-08-01', endsOn: '2026-09-01', resumeOn: '2026-09-15' })
    const payload = buildPlanningImpactProposalPayload(effect)
    expect(payload).toEqual({
      operation: 'suspend',
      effectiveFrom: '2026-08-01',
      effectiveTo: '2026-09-01',
      resumeOn: '2026-09-15',
    })
  })

  it('CONFIRM — jamais un impact Planning, rend null (doctrine 8)', () => {
    const effect = row({ id: 'e-confirm', effect: 'confirm' })
    expect(buildPlanningImpactProposalPayload(effect)).toBeNull()
  })
})

describe('computePlanningImpactProposalFingerprint', () => {
  it('déterministe — même entrée produit toujours le même hash', () => {
    const input = {
      contractEffectId: 'eff-1',
      impactKind: 'modify' as const,
      proposalPayload: { operation: 'change_frequency', scopeKey: 'frequency', effectiveFrom: '2026-12-01', effectiveTo: null, from: null, to: { frequency: 'weekly' } },
      proposalVersion: 1,
    }
    expect(computePlanningImpactProposalFingerprint(input)).toBe(computePlanningImpactProposalFingerprint(input))
  })

  it('insensible à l\'ordre des clés du payload (canonicalStringify)', () => {
    const payloadA: NewPlanningImpactPayload = { operation: 'new', temporality: 'permanent', effectiveFrom: '2026-01-01', effectiveTo: null }
    const payloadB: NewPlanningImpactPayload = { effectiveTo: null, effectiveFrom: '2026-01-01', temporality: 'permanent', operation: 'new' }
    const a = computePlanningImpactProposalFingerprint({
      contractEffectId: 'eff-1',
      impactKind: 'new',
      proposalPayload: payloadA,
      proposalVersion: 1,
    })
    const b = computePlanningImpactProposalFingerprint({
      proposalVersion: 1,
      impactKind: 'new',
      proposalPayload: payloadB,
      contractEffectId: 'eff-1',
    })
    expect(a).toBe(b)
  })

  it('change si le contenu du payload change', () => {
    const base = {
      contractEffectId: 'eff-1',
      impactKind: 'suspend' as const,
      proposalVersion: 1,
    }
    const a = computePlanningImpactProposalFingerprint({ ...base, proposalPayload: { operation: 'suspend', effectiveFrom: '2026-08-01', effectiveTo: null, resumeOn: null } })
    const b = computePlanningImpactProposalFingerprint({ ...base, proposalPayload: { operation: 'suspend', effectiveFrom: '2026-08-01', effectiveTo: null, resumeOn: '2026-09-15' } })
    expect(a).not.toBe(b)
  })

  it('change si la version change, contenu identique par ailleurs', () => {
    const payload: NewPlanningImpactPayload = { operation: 'new', temporality: 'permanent', effectiveFrom: '2026-01-01', effectiveTo: null }
    const a = computePlanningImpactProposalFingerprint({ contractEffectId: 'eff-1', impactKind: 'new', proposalPayload: payload, proposalVersion: 1 })
    const b = computePlanningImpactProposalFingerprint({ contractEffectId: 'eff-1', impactKind: 'new', proposalPayload: payload, proposalVersion: 2 })
    expect(a).not.toBe(b)
  })

  it('change si contract_effect_id change, contenu identique par ailleurs', () => {
    const payload: NewPlanningImpactPayload = { operation: 'new', temporality: 'permanent', effectiveFrom: '2026-01-01', effectiveTo: null }
    const a = computePlanningImpactProposalFingerprint({ contractEffectId: 'eff-1', impactKind: 'new', proposalPayload: payload, proposalVersion: 1 })
    const b = computePlanningImpactProposalFingerprint({ contractEffectId: 'eff-2', impactKind: 'new', proposalPayload: payload, proposalVersion: 1 })
    expect(a).not.toBe(b)
  })
})

describe('resolvePlanningApplicationCapability', () => {
  it('NEW — jamais applicable, décisions manquantes = jour/heure/équipe/durée', () => {
    const capability = resolvePlanningApplicationCapability('new')
    expect(capability.applicable).toBe(false)
    expect(capability.blockingReason).toBe('new_requires_human_scheduling')
    expect(capability.missingDecisions).toEqual(['jour', 'heure', 'équipe', 'durée'])
  })

  it('MODIFY — jamais applicable, pas de mécanisme natif de régénération de cycle', () => {
    const capability = resolvePlanningApplicationCapability('modify')
    expect(capability.applicable).toBe(false)
    expect(capability.blockingReason).toBe('no_native_recurring_frequency_change')
  })

  it('SUSPEND — jamais applicable, pas de mécanisme natif de suspension/reprise', () => {
    const capability = resolvePlanningApplicationCapability('suspend')
    expect(capability.applicable).toBe(false)
    expect(capability.blockingReason).toBe('no_native_suspend_resume')
  })
})
