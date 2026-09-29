// DOC-CONTRACT-OS-1B4-B (mandat Vincent 2026-09-30, « STRUCTURED PLANNING
// RELEVANCE ») — tests purs du moteur de construction des Propositions
// d'impact Planning (lib/engagements/planning-impact-proposal.ts). Aucun
// accès DB : reflète la discipline de resolve-contract-state.test.ts.
//
// GAP RÉSOLU : la brique cadence structurée (1B4-B0, effect_payload.cadence)
// fournit désormais la preuve Planning — NEW/MODIFY(frequency)/SUSPEND ne
// génèrent une proposition QUE si une cadence structurée est connue, jamais
// dérivée de description/frequency_raw/source_excerpt/label/category/
// measurable.

import { describe, it, expect } from 'vitest'
import {
  buildPlanningImpactProposalPayload,
  computePlanningImpactProposalFingerprint,
  resolvePlanningApplicationCapability,
  type NewPlanningImpactPayload,
  type ModifyFrequencyPlanningImpactPayload,
  type SuspendPlanningImpactPayload,
} from '@/lib/engagements/planning-impact-proposal'
import { resolveContractCadenceAtDate } from '@/lib/engagements/contract-cadence'
import { resolveEngagementAtDate } from '@/lib/engagements/resolve-contract-state'
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
  it('NEW — cadence structurée valide → proposition avec cadence, aucune donnée Planning', () => {
    const effect = row({
      id: 'e-new',
      effect: 'new',
      temporality: 'bounded',
      startsOn: '2026-10-01',
      endsOn: '2026-12-31',
      scopeKey: 'whole_engagement',
      effectPayload: { description: 'Relevé photo hebdomadaire', cadence: { count: 1, period: 'week' } },
    })
    const payload = buildPlanningImpactProposalPayload(effect)
    expect(payload).toEqual({
      operation: 'new',
      temporality: 'bounded',
      effectiveFrom: '2026-10-01',
      effectiveTo: '2026-12-31',
      scopeKey: 'whole_engagement',
      cadence: { count: 1, period: 'week' },
    })
  })

  it('NEW — sans cadence structurée (même avec description riche) → aucune proposition', () => {
    const effect = row({
      id: 'e-new-no-cadence',
      effect: 'new',
      startsOn: '2026-10-01',
      effectPayload: { description: 'Relevé photo hebdomadaire', frequency_raw: 'hebdomadaire' },
    })
    expect(buildPlanningImpactProposalPayload(effect)).toBeNull()
  })

  it('MODIFY frequency — toCadence structurée + fromCadence fournie par le contexte → proposition structurée', () => {
    const effect = row({
      id: 'e-mod-freq',
      effect: 'modify',
      scopeKey: 'frequency',
      startsOn: '2026-12-01',
      endsOn: null,
      effectPayload: { cadence: { count: 3, period: 'week' } },
    })
    const payload = buildPlanningImpactProposalPayload(effect, { priorCadence: { count: 2, period: 'week' } })
    expect(payload).toEqual({
      operation: 'change_frequency',
      scopeKey: 'frequency',
      effectiveFrom: '2026-12-01',
      effectiveTo: null,
      fromCadence: { count: 2, period: 'week' },
      toCadence: { count: 3, period: 'week' },
    })
  })

  it('MODIFY frequency — sans priorCadence fourni par le contexte, fromCadence vaut null (jamais une invention)', () => {
    const effect = row({
      id: 'e-mod-freq-2',
      effect: 'modify',
      scopeKey: 'frequency',
      startsOn: '2026-12-01',
      effectPayload: { cadence: { count: 1, period: 'month' } },
    })
    const payload = buildPlanningImpactProposalPayload(effect) as ModifyFrequencyPlanningImpactPayload
    expect(payload.fromCadence).toBeNull()
    expect(payload.toCadence).toEqual({ count: 1, period: 'month' })
  })

  it('MODIFY frequency — sans cadence structurée cible (description libre seule) → aucune proposition, jamais parsée', () => {
    const effect = row({
      id: 'e-mod-freq-3',
      effect: 'modify',
      scopeKey: 'frequency',
      startsOn: '2026-12-01',
      effectPayload: { description: 'passage de 2 à 3 fois par semaine' },
    })
    expect(buildPlanningImpactProposalPayload(effect, { priorCadence: { count: 2, period: 'week' } })).toBeNull()
  })

  it('MODIFY sur scope_key Planning-relevant hors frequency (schedule) — comportement opaque inchangé', () => {
    const effect = row({
      id: 'e-mod-schedule',
      effect: 'modify',
      scopeKey: 'schedule',
      startsOn: '2026-11-01',
      effectPayload: { description: 'nouveau créneau' },
    })
    const payload = buildPlanningImpactProposalPayload(effect, { priorScopeValue: { description: 'ancien créneau' } })
    expect(payload).toEqual({
      operation: 'change_schedule',
      scopeKey: 'schedule',
      effectiveFrom: '2026-11-01',
      effectiveTo: null,
      from: { description: 'ancien créneau' },
      to: { description: 'nouveau créneau' },
    })
  })

  it('MODIFY — scope_key hors PLANNING_RELEVANT_MODIFY_SCOPE_KEYS rend null (effet ≠ impact Planning)', () => {
    const effect = row({ id: 'e-mod-3', effect: 'modify', scopeKey: 'lot_a', startsOn: '2026-11-01', effectPayload: { description: '+10%' } })
    expect(buildPlanningImpactProposalPayload(effect)).toBeNull()
  })

  it('SUSPEND — priorCadence structurée fournie par le contexte → proposition, jamais copiée dans l\'effet lui-même', () => {
    const effect = row({ id: 'e-susp', effect: 'suspend', startsOn: '2026-08-01', endsOn: '2026-09-01', resumeOn: '2026-09-15' })
    const payload = buildPlanningImpactProposalPayload(effect, { priorCadence: { count: 2, period: 'week' } })
    expect(payload).toEqual({
      operation: 'suspend',
      effectiveFrom: '2026-08-01',
      effectiveTo: '2026-09-01',
      resumeOn: '2026-09-15',
      priorCadence: { count: 2, period: 'week' },
    })
    expect(effect.effectPayload).toEqual({})
  })

  it('SUSPEND — sans cadence structurée connue (contexte absent ou null) → aucune proposition', () => {
    const effect = row({ id: 'e-susp-2', effect: 'suspend', startsOn: '2026-08-01', endsOn: '2026-09-01', resumeOn: '2026-09-15' })
    expect(buildPlanningImpactProposalPayload(effect)).toBeNull()
    expect(buildPlanningImpactProposalPayload(effect, { priorCadence: null })).toBeNull()
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
      proposalPayload: {
        operation: 'change_frequency' as const,
        scopeKey: 'frequency' as const,
        effectiveFrom: '2026-12-01',
        effectiveTo: null,
        fromCadence: { count: 2, period: 'week' as const },
        toCadence: { count: 3, period: 'week' as const },
      },
      proposalVersion: 1,
    }
    expect(computePlanningImpactProposalFingerprint(input)).toBe(computePlanningImpactProposalFingerprint(input))
  })

  it('insensible à l\'ordre des clés du payload (canonicalStringify)', () => {
    const payloadA: NewPlanningImpactPayload = {
      operation: 'new',
      temporality: 'permanent',
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      scopeKey: 'whole_engagement',
      cadence: { count: 1, period: 'week' },
    }
    const payloadB: NewPlanningImpactPayload = {
      effectiveTo: null,
      effectiveFrom: '2026-01-01',
      temporality: 'permanent',
      operation: 'new',
      cadence: { period: 'week', count: 1 },
      scopeKey: 'whole_engagement',
    }
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
    const a = computePlanningImpactProposalFingerprint({
      ...base,
      proposalPayload: { operation: 'suspend', effectiveFrom: '2026-08-01', effectiveTo: null, resumeOn: null, priorCadence: { count: 2, period: 'week' } },
    })
    const b = computePlanningImpactProposalFingerprint({
      ...base,
      proposalPayload: { operation: 'suspend', effectiveFrom: '2026-08-01', effectiveTo: null, resumeOn: '2026-09-15', priorCadence: { count: 2, period: 'week' } },
    })
    expect(a).not.toBe(b)
  })

  it('change si la version change, contenu identique par ailleurs', () => {
    const payload: NewPlanningImpactPayload = {
      operation: 'new',
      temporality: 'permanent',
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      scopeKey: 'whole_engagement',
      cadence: { count: 1, period: 'week' },
    }
    const a = computePlanningImpactProposalFingerprint({ contractEffectId: 'eff-1', impactKind: 'new', proposalPayload: payload, proposalVersion: 1 })
    const b = computePlanningImpactProposalFingerprint({ contractEffectId: 'eff-1', impactKind: 'new', proposalPayload: payload, proposalVersion: 2 })
    expect(a).not.toBe(b)
  })

  it('change si contract_effect_id change, contenu identique par ailleurs', () => {
    const payload: NewPlanningImpactPayload = {
      operation: 'new',
      temporality: 'permanent',
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      scopeKey: 'whole_engagement',
      cadence: { count: 1, period: 'week' },
    }
    const a = computePlanningImpactProposalFingerprint({ contractEffectId: 'eff-1', impactKind: 'new', proposalPayload: payload, proposalVersion: 1 })
    const b = computePlanningImpactProposalFingerprint({ contractEffectId: 'eff-2', impactKind: 'new', proposalPayload: payload, proposalVersion: 1 })
    expect(a).not.toBe(b)
  })

  it('règle 7 (mandat 1B4-B) — NEW 1/semaine vs NEW 2/semaine produisent des fingerprints distincts', () => {
    const base = { contractEffectId: 'eff-new', impactKind: 'new' as const, proposalVersion: 1 }
    const payload1Week: NewPlanningImpactPayload = {
      operation: 'new',
      temporality: 'bounded',
      effectiveFrom: '2026-12-01',
      effectiveTo: '2027-01-31',
      scopeKey: 'whole_engagement',
      cadence: { count: 1, period: 'week' },
    }
    const payload2Week: NewPlanningImpactPayload = { ...payload1Week, cadence: { count: 2, period: 'week' } }
    const a = computePlanningImpactProposalFingerprint({ ...base, proposalPayload: payload1Week })
    const b = computePlanningImpactProposalFingerprint({ ...base, proposalPayload: payload2Week })
    expect(a).not.toBe(b)
  })

  it('règle 7 (mandat 1B4-B) — MODIFY vers 3/semaine vs vers 4/semaine produisent des fingerprints distincts', () => {
    const base = { contractEffectId: 'eff-mod', impactKind: 'modify' as const, proposalVersion: 1 }
    const payloadTo3: ModifyFrequencyPlanningImpactPayload = {
      operation: 'change_frequency',
      scopeKey: 'frequency',
      effectiveFrom: '2026-12-01',
      effectiveTo: null,
      fromCadence: { count: 2, period: 'week' },
      toCadence: { count: 3, period: 'week' },
    }
    const payloadTo4: ModifyFrequencyPlanningImpactPayload = { ...payloadTo3, toCadence: { count: 4, period: 'week' } }
    const a = computePlanningImpactProposalFingerprint({ ...base, proposalPayload: payloadTo3 })
    const b = computePlanningImpactProposalFingerprint({ ...base, proposalPayload: payloadTo4 })
    expect(a).not.toBe(b)
  })
})

describe('resolvePlanningApplicationCapability', () => {
  it('NEW — partially_representable (verdict 1B4-A FINAL CLOSED), décisions manquantes = jour/heure/équipe/durée', () => {
    const payload: NewPlanningImpactPayload = {
      operation: 'new',
      temporality: 'permanent',
      effectiveFrom: null,
      effectiveTo: null,
      scopeKey: 'whole_engagement',
      cadence: { count: 1, period: 'week' },
    }
    const capability = resolvePlanningApplicationCapability('new', payload)
    expect(capability.readiness).toBe('partially_representable')
    expect(capability.blockingReason).toBe('new_requires_human_scheduling')
    expect(capability.missingDecisions).toEqual(['jour', 'heure', 'équipe', 'durée'])
  })

  it('MODIFY sur scope_key Planning-relevant (frequency/schedule) — partially_representable, mécanisme natif existe mais requiert un ciblage humain', () => {
    const payload: ModifyFrequencyPlanningImpactPayload = {
      operation: 'change_frequency',
      scopeKey: 'frequency',
      effectiveFrom: '2026-12-01',
      effectiveTo: null,
      fromCadence: null,
      toCadence: { count: 1, period: 'week' },
    }
    const capability = resolvePlanningApplicationCapability('modify', payload)
    expect(capability.readiness).toBe('partially_representable')
    expect(capability.blockingReason).toBe('recurring_change_requires_mission_targeting')
    expect(capability.missingDecisions).toEqual(['cycle_planning_cible', 'occurrences_a_regenerer'])
  })

  it('MODIFY sur scope_key non Planning — no_application, aucune décision ne rendrait le cas applicable', () => {
    const payload = { operation: 'change_lot_a', scopeKey: 'lot_a', effectiveFrom: '2026-11-01', effectiveTo: null, from: null, to: {} }
    const capability = resolvePlanningApplicationCapability('modify', payload)
    expect(capability.readiness).toBe('no_application')
    expect(capability.blockingReason).toBe('scope_not_planning_related')
    expect(capability.missingDecisions).toEqual([])
  })

  it('SUSPEND — blocked_by_planning_model, pas de mécanisme natif de suspension/reprise', () => {
    const payload: SuspendPlanningImpactPayload = {
      operation: 'suspend',
      effectiveFrom: '2026-08-01',
      effectiveTo: null,
      resumeOn: null,
      priorCadence: { count: 1, period: 'week' },
    }
    const capability = resolvePlanningApplicationCapability('suspend', payload)
    expect(capability.readiness).toBe('blocked_by_planning_model')
    expect(capability.blockingReason).toBe('no_native_suspend_resume')
  })
})

// OS15 — véritable témoin de fermeture DOC-CONTRACT-OS-1B4-B (mandat GO
// Vincent 2026-09-30, « STRUCTURED PLANNING RELEVANCE »). Reprend EXACTEMENT
// le golden witness du verdict 1B4-B0 (mêmes engagementId que
// contract-cadence.test.ts, CAS A-D) et prouve, pour chacun, qu'une
// proposition Planning n'existe QUE si une cadence structurée est connue —
// jamais dérivée de description/frequency_raw. Chaque cas porte sur un
// Engagement distinct : jamais deux scénarios sous le même engagementId.
describe('OS15 — véritable témoin de fermeture 1B4-B (structured planning relevance)', () => {
  it('CAS A — MODIFY Z1 : 2/semaine → 3/semaine exactement au 2026-12-01, proposition structurée from/to', () => {
    const founder = row({
      id: 'z1-new',
      engagementId: 'eng-z1',
      effect: 'new',
      temporality: 'permanent',
      scopeKey: 'whole_engagement',
      startsOn: '2026-01-01',
      endsOn: null,
      effectPayload: { cadence: { count: 2, period: 'week' } },
    })
    const modifyTo3 = row({
      id: 'z1-mod-3',
      engagementId: 'eng-z1',
      effect: 'modify',
      scopeKey: 'frequency',
      startsOn: '2026-12-01',
      endsOn: null,
      effectPayload: { cadence: { count: 3, period: 'week' } },
    })
    const effects = [founder, modifyTo3]
    const dayBefore = resolveEngagementAtDate({ engagementId: 'eng-z1', effects }, '2026-11-30')
    const priorCadence = resolveContractCadenceAtDate(effects, dayBefore)

    const payload = buildPlanningImpactProposalPayload(modifyTo3, { priorCadence })
    expect(payload).toEqual({
      operation: 'change_frequency',
      scopeKey: 'frequency',
      effectiveFrom: '2026-12-01',
      effectiveTo: null,
      fromCadence: { count: 2, period: 'week' },
      toCadence: { count: 3, period: 'week' },
    })

    const capability = resolvePlanningApplicationCapability('modify', payload!)
    expect(capability.readiness).toBe('partially_representable')
    expect(capability.blockingReason).toBe('recurring_change_requires_mission_targeting')
  })

  it('CAS A (contre-témoin) — MODIFY frequency sans cadence structurée cible (description libre) → aucune proposition', () => {
    const founder = row({
      id: 'z1b-new',
      engagementId: 'eng-z1-sans-cadence',
      effect: 'new',
      temporality: 'permanent',
      scopeKey: 'whole_engagement',
      startsOn: '2026-01-01',
      endsOn: null,
      effectPayload: { cadence: { count: 2, period: 'week' } },
    })
    const modifyDescriptionOnly = row({
      id: 'z1b-mod',
      engagementId: 'eng-z1-sans-cadence',
      effect: 'modify',
      scopeKey: 'frequency',
      startsOn: '2026-12-01',
      endsOn: null,
      effectPayload: { description: 'passage de 2 à 3 fois par semaine' },
    })
    const effects = [founder, modifyDescriptionOnly]
    const dayBefore = resolveEngagementAtDate({ engagementId: 'eng-z1-sans-cadence', effects }, '2026-11-30')
    const priorCadence = resolveContractCadenceAtDate(effects, dayBefore)
    expect(buildPlanningImpactProposalPayload(modifyDescriptionOnly, { priorCadence })).toBeNull()
  })

  it('CAS B — NEW relevé photo (2026-12-01→2027-01-31) : 1/semaine structuré → proposition', () => {
    const releve = row({
      id: 'releve-new',
      engagementId: 'eng-releve-photo',
      effect: 'new',
      temporality: 'bounded',
      scopeKey: 'whole_engagement',
      startsOn: '2026-12-01',
      endsOn: '2027-01-31',
      effectPayload: { description: 'Relevé photo', cadence: { count: 1, period: 'week' } },
    })
    const payload = buildPlanningImpactProposalPayload(releve)
    expect(payload).toEqual({
      operation: 'new',
      temporality: 'bounded',
      effectiveFrom: '2026-12-01',
      effectiveTo: '2027-01-31',
      scopeKey: 'whole_engagement',
      cadence: { count: 1, period: 'week' },
    })

    const capability = resolvePlanningApplicationCapability('new', payload!)
    expect(capability.readiness).toBe('partially_representable')
    expect(capability.blockingReason).toBe('new_requires_human_scheduling')
    expect(capability.missingDecisions).toEqual(['jour', 'heure', 'équipe', 'durée'])
  })

  it('CAS B (contre-témoin) — NEW identique SANS cadence structurée → aucune proposition', () => {
    const releveSansCadence = row({
      id: 'releve-new-sans-cadence',
      engagementId: 'eng-releve-photo-sans-cadence',
      effect: 'new',
      temporality: 'bounded',
      scopeKey: 'whole_engagement',
      startsOn: '2026-12-01',
      endsOn: '2027-01-31',
      effectPayload: { description: 'Relevé photo', frequency_raw: 'hebdomadaire' },
    })
    expect(buildPlanningImpactProposalPayload(releveSansCadence)).toBeNull()
  })

  it('CAS C — SUSPEND Z4 : cadence connue au 2026-12-09, SUSPEND 10→14, reprise 15 → proposition, jamais copiée dans l\'effet', () => {
    const founder = row({
      id: 'z4-new',
      engagementId: 'eng-z4',
      effect: 'new',
      temporality: 'permanent',
      scopeKey: 'whole_engagement',
      startsOn: '2026-01-01',
      endsOn: null,
      effectPayload: { cadence: { count: 2, period: 'week' } },
    })
    const suspend = row({
      id: 'z4-suspend',
      engagementId: 'eng-z4',
      effect: 'suspend',
      scopeKey: 'whole_engagement',
      temporality: 'bounded',
      startsOn: '2026-12-10',
      endsOn: '2026-12-14',
      resumeOn: '2026-12-15',
    })
    const effects = [founder, suspend]
    const dayBeforeSuspend = resolveEngagementAtDate({ engagementId: 'eng-z4', effects }, '2026-12-09')
    const priorCadence = resolveContractCadenceAtDate(effects, dayBeforeSuspend)

    const payload = buildPlanningImpactProposalPayload(suspend, { priorCadence })
    expect(payload).toEqual({
      operation: 'suspend',
      effectiveFrom: '2026-12-10',
      effectiveTo: '2026-12-14',
      resumeOn: '2026-12-15',
      priorCadence: { count: 2, period: 'week' },
    })
    expect(suspend.effectPayload).toEqual({})

    const capability = resolvePlanningApplicationCapability('suspend', payload!)
    expect(capability.readiness).toBe('blocked_by_planning_model')
    expect(capability.blockingReason).toBe('no_native_suspend_resume')
  })

  it('CAS C (contre-témoin) — même SUSPEND sur un Engagement sans cadence structurée → aucune proposition', () => {
    const founderLegacy = row({
      id: 'z4b-new',
      engagementId: 'eng-z4-sans-cadence',
      effect: 'new',
      temporality: 'permanent',
      scopeKey: 'whole_engagement',
      startsOn: '2026-01-01',
      endsOn: null,
      effectPayload: { description: 'contrat legacy sans cadence structurée' },
    })
    const suspendLegacy = row({
      id: 'z4b-suspend',
      engagementId: 'eng-z4-sans-cadence',
      effect: 'suspend',
      scopeKey: 'whole_engagement',
      temporality: 'bounded',
      startsOn: '2026-12-10',
      endsOn: '2026-12-14',
      resumeOn: '2026-12-15',
    })
    const effects = [founderLegacy, suspendLegacy]
    const dayBeforeSuspend = resolveEngagementAtDate({ engagementId: 'eng-z4-sans-cadence', effects }, '2026-12-09')
    const priorCadence = resolveContractCadenceAtDate(effects, dayBeforeSuspend)
    expect(priorCadence).toBeNull()
    expect(buildPlanningImpactProposalPayload(suspendLegacy, { priorCadence })).toBeNull()
  })

  it('CAS D — CONFIRM sur Engagement indépendant : jamais un impact Planning, rend null', () => {
    const founder = row({
      id: 'confirm-target-new',
      engagementId: 'eng-confirm-target',
      effect: 'new',
      temporality: 'permanent',
      scopeKey: 'whole_engagement',
      startsOn: '2026-01-01',
      endsOn: null,
      effectPayload: { cadence: { count: 1, period: 'week' } },
    })
    const confirm = row({
      id: 'confirm-target-confirm',
      engagementId: 'eng-confirm-target',
      effect: 'confirm',
      scopeKey: 'whole_engagement',
      startsOn: '2026-12-20',
      effectPayload: {},
    })
    const effects = [founder, confirm]
    const state = resolveEngagementAtDate({ engagementId: 'eng-confirm-target', effects }, '2026-12-20')
    const priorCadence = resolveContractCadenceAtDate(effects, state)
    expect(priorCadence).toEqual({ count: 1, period: 'week' })
    expect(buildPlanningImpactProposalPayload(confirm, { priorCadence })).toBeNull()
  })

  it('MODIFY sur scope_key non Planning-relevant (quantity) — aucune proposition, effet ≠ impact Planning', () => {
    const effect = row({
      id: 'e-os15-mod-lot',
      effect: 'modify',
      scopeKey: 'quantity',
      startsOn: '2026-11-01',
      effectPayload: { description: '+10% de surface' },
    })
    expect(buildPlanningImpactProposalPayload(effect)).toBeNull()
  })
})
