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
  it('NEW — reprend temporalité + bornes + scope_key/effect_payload qualifiés, jamais de donnée Planning', () => {
    const effect = row({
      id: 'e-new',
      effect: 'new',
      temporality: 'bounded',
      startsOn: '2026-10-01',
      endsOn: '2026-12-31',
      scopeKey: 'whole_engagement',
      effectPayload: { description: 'Relevé photo hebdomadaire' },
    })
    const payload = buildPlanningImpactProposalPayload(effect)
    expect(payload).toEqual({
      operation: 'new',
      temporality: 'bounded',
      effectiveFrom: '2026-10-01',
      effectiveTo: '2026-12-31',
      scopeKey: 'whole_engagement',
      effectPayload: { description: 'Relevé photo hebdomadaire' },
    })
  })

  it('MODIFY — operation générique change_<scopeKey>, from/to portés par l\'appelant (scope_key Planning-relevant)', () => {
    const effect = row({
      id: 'e-mod',
      effect: 'modify',
      scopeKey: 'frequency',
      startsOn: '2026-12-01',
      endsOn: null,
      effectPayload: { description: 'passage à hebdomadaire' },
    })
    const payload = buildPlanningImpactProposalPayload(effect, { description: 'mensuel' })
    expect(payload).toEqual({
      operation: 'change_frequency',
      scopeKey: 'frequency',
      effectiveFrom: '2026-12-01',
      effectiveTo: null,
      from: { description: 'mensuel' },
      to: { description: 'passage à hebdomadaire' },
    })
  })

  it('MODIFY — sans priorScopeValue fourni, from vaut null (scope_key Planning-relevant)', () => {
    const effect = row({ id: 'e-mod-2', effect: 'modify', scopeKey: 'schedule', startsOn: '2026-11-01', effectPayload: { description: 'nouveau créneau' } })
    const payload = buildPlanningImpactProposalPayload(effect)
    expect(payload).toMatchObject({ from: null, to: { description: 'nouveau créneau' } })
  })

  it('MODIFY — scope_key hors PLANNING_RELEVANT_MODIFY_SCOPE_KEYS rend null (doctrine FIX 4, effet ≠ impact Planning)', () => {
    const effect = row({ id: 'e-mod-3', effect: 'modify', scopeKey: 'lot_a', startsOn: '2026-11-01', effectPayload: { description: '+10%' } })
    expect(buildPlanningImpactProposalPayload(effect)).toBeNull()
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
    const payloadA: NewPlanningImpactPayload = { operation: 'new', temporality: 'permanent', effectiveFrom: '2026-01-01', effectiveTo: null, scopeKey: 'whole_engagement', effectPayload: {} }
    const payloadB: NewPlanningImpactPayload = { effectiveTo: null, effectiveFrom: '2026-01-01', temporality: 'permanent', operation: 'new', effectPayload: {}, scopeKey: 'whole_engagement' }
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
    const payload: NewPlanningImpactPayload = { operation: 'new', temporality: 'permanent', effectiveFrom: '2026-01-01', effectiveTo: null, scopeKey: 'whole_engagement', effectPayload: {} }
    const a = computePlanningImpactProposalFingerprint({ contractEffectId: 'eff-1', impactKind: 'new', proposalPayload: payload, proposalVersion: 1 })
    const b = computePlanningImpactProposalFingerprint({ contractEffectId: 'eff-1', impactKind: 'new', proposalPayload: payload, proposalVersion: 2 })
    expect(a).not.toBe(b)
  })

  it('change si contract_effect_id change, contenu identique par ailleurs', () => {
    const payload: NewPlanningImpactPayload = { operation: 'new', temporality: 'permanent', effectiveFrom: '2026-01-01', effectiveTo: null, scopeKey: 'whole_engagement', effectPayload: {} }
    const a = computePlanningImpactProposalFingerprint({ contractEffectId: 'eff-1', impactKind: 'new', proposalPayload: payload, proposalVersion: 1 })
    const b = computePlanningImpactProposalFingerprint({ contractEffectId: 'eff-2', impactKind: 'new', proposalPayload: payload, proposalVersion: 1 })
    expect(a).not.toBe(b)
  })
})

describe('resolvePlanningApplicationCapability', () => {
  it('NEW — partially_representable (verdict 1B4-A FINAL CLOSED), décisions manquantes = jour/heure/équipe/durée', () => {
    const payload: NewPlanningImpactPayload = { operation: 'new', temporality: 'permanent', effectiveFrom: null, effectiveTo: null, scopeKey: 'whole_engagement', effectPayload: {} }
    const capability = resolvePlanningApplicationCapability('new', payload)
    expect(capability.readiness).toBe('partially_representable')
    expect(capability.blockingReason).toBe('new_requires_human_scheduling')
    expect(capability.missingDecisions).toEqual(['jour', 'heure', 'équipe', 'durée'])
  })

  it('MODIFY sur scope_key Planning-relevant (frequency/schedule) — partially_representable, mécanisme natif existe mais requiert un ciblage humain', () => {
    const payload = { operation: 'change_frequency', scopeKey: 'frequency', effectiveFrom: '2026-12-01', effectiveTo: null, from: null, to: {} }
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
    const payload = { operation: 'suspend' as const, effectiveFrom: '2026-08-01', effectiveTo: null, resumeOn: null }
    const capability = resolvePlanningApplicationCapability('suspend', payload)
    expect(capability.readiness).toBe('blocked_by_planning_model')
    expect(capability.blockingReason).toBe('no_native_suspend_resume')
  })
})

// OS15 — véritable témoin de fermeture DOC-CONTRACT-OS-1B4-B (mandat
// FIX_REQUIRED Vincent 2026-09-30, 2e revue « STRUCTURED PLANNING RELEVANCE +
// TRUE OS15 ») : reprend EXACTEMENT le golden witness du verdict (NEW relevé
// photo hebdomadaire 2026-12-01→2027-01-31 ; MODIFY 2→3 passages/semaine au
// 2026-12-01 ; SUSPEND 2026-12-10→2026-12-14, reprise 2026-12-15 ; CONFIRM
// sans impact). Chaque cas vérifie explicitement qu'aucune fréquence
// structurée n'est dérivée du texte libre de effect_payload.description — la
// 1re revue avait fabriqué un faux témoin en traitant cette description comme
// une donnée métier ; l'audit FIX C (READ-ONLY) a confirmé qu'aucune source
// structurée de fréquence/récurrence n'existe dans le domaine
// Engagement/contract-effect (seule Planning, via intervention_templates,
// porte une récurrence structurée — domaine distinct, non pontée ici).
describe('OS15 — véritable témoin de fermeture 1B4-B (golden witness)', () => {
  it('NEW — relevé photo hebdomadaire (2026-12-01→2027-01-31) : payload opaque préservé tel quel, jamais parsé', () => {
    const effect = row({
      id: 'e-os15-new',
      effect: 'new',
      temporality: 'bounded',
      startsOn: '2026-12-01',
      endsOn: '2027-01-31',
      scopeKey: 'reporting',
      effectPayload: { description: 'Relevé photo hebdomadaire zone Z2' },
    })
    const payload = buildPlanningImpactProposalPayload(effect) as NewPlanningImpactPayload
    expect(payload).toEqual({
      operation: 'new',
      temporality: 'bounded',
      effectiveFrom: '2026-12-01',
      effectiveTo: '2027-01-31',
      scopeKey: 'reporting',
      effectPayload: { description: 'Relevé photo hebdomadaire zone Z2' },
    })
    // Aucune fréquence structurée n'est synthétisée depuis le texte : la seule
    // clé transportée est la description humaine brute.
    expect(Object.keys(payload.effectPayload)).toEqual(['description'])

    const capability = resolvePlanningApplicationCapability('new', payload)
    expect(capability.readiness).toBe('partially_representable')
    expect(capability.blockingReason).toBe('new_requires_human_scheduling')
    expect(capability.missingDecisions).toEqual(['jour', 'heure', 'équipe', 'durée'])
  })

  it('MODIFY — 2 à 3 passages/semaine au 2026-12-01 : from/to opaques préservés, jamais un frequency structuré inventé', () => {
    const effect = row({
      id: 'e-os15-mod-freq',
      effect: 'modify',
      scopeKey: 'frequency',
      startsOn: '2026-12-01',
      endsOn: null,
      effectPayload: { description: 'passage de 2 à 3 passages par semaine' },
    })
    const priorScopeValue = { description: '2 passages par semaine' }
    const payload = buildPlanningImpactProposalPayload(effect, priorScopeValue)
    expect(payload).toEqual({
      operation: 'change_frequency',
      scopeKey: 'frequency',
      effectiveFrom: '2026-12-01',
      effectiveTo: null,
      from: { description: '2 passages par semaine' },
      to: { description: 'passage de 2 à 3 passages par semaine' },
    })
    expect(Object.keys((payload as { to: Record<string, unknown> }).to)).toEqual(['description'])

    const capability = resolvePlanningApplicationCapability('modify', payload!)
    expect(capability.readiness).toBe('partially_representable')
    expect(capability.blockingReason).toBe('recurring_change_requires_mission_targeting')
  })

  it('SUSPEND — 2026-12-10 → 2026-12-14, reprise 2026-12-15 : dates structurées reprises exactement', () => {
    const effect = row({
      id: 'e-os15-suspend',
      effect: 'suspend',
      startsOn: '2026-12-10',
      endsOn: '2026-12-14',
      resumeOn: '2026-12-15',
    })
    const payload = buildPlanningImpactProposalPayload(effect)
    expect(payload).toEqual({
      operation: 'suspend',
      effectiveFrom: '2026-12-10',
      effectiveTo: '2026-12-14',
      resumeOn: '2026-12-15',
    })
    const capability = resolvePlanningApplicationCapability('suspend', payload!)
    expect(capability.readiness).toBe('blocked_by_planning_model')
    expect(capability.blockingReason).toBe('no_native_suspend_resume')
  })

  it('CONFIRM — jamais un impact Planning, rend null', () => {
    const effect = row({ id: 'e-os15-confirm', effect: 'confirm' })
    expect(buildPlanningImpactProposalPayload(effect)).toBeNull()
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
