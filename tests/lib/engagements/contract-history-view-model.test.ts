// DOC-CONTRACT-OS-1B3 (mandat Vincent 2026-09-29) — `buildEngagementContractHistoryViewModel`
// est un presenter PUR : ces tests construisent des `EngagementContractStateDTO` fixtures
// directement (aucun appel réseau, aucune re-résolution temporelle via
// `resolveEngagementAtDate`/`resolveEngagementContractStateForUser`) et vérifient uniquement
// le FORMATAGE/CLASSEMENT. Les fixtures OS15 reprennent les 4 cas golden witness de
// tests/lib/engagements/resolve-contract-state.test.ts.
import { describe, it, expect } from 'vitest'
import { buildEngagementContractHistoryViewModel } from '@/lib/engagements/contract-history-view-model'
import type { EngagementContractStateDTO, ProvenanceEntry, ScopeState } from '@/lib/engagements/resolve-contract-state'

function baseScope(overrides: Partial<ScopeState> = {}): ScopeState {
  return {
    scopeKey: 'frequency',
    applicability: 'applicable',
    dominatedByWholeEngagementSuspend: false,
    basis: 'engagement_base',
    value: null,
    sourceEffectId: null,
    valueConflict: null,
    applicabilityConflict: null,
    indeterminateReason: null,
    ...overrides,
  }
}

function baseState(overrides: Partial<EngagementContractStateDTO> = {}): EngagementContractStateDTO {
  return {
    engagementId: 'eng-1',
    queriedDate: '2026-09-29',
    resolvable: true,
    resolutionIssue: null,
    existence: { status: 'exists', foundedBy: null, existsFrom: null, existsUntil: null },
    scopes: [],
    anomalies: [],
    provenanceTrail: [],
    ...overrides,
  }
}

function entry(overrides: Partial<ProvenanceEntry> & Pick<ProvenanceEntry, 'effectId' | 'effect' | 'scopeKey'>): ProvenanceEntry {
  return {
    temporality: 'permanent',
    startsOn: null,
    endsOn: null,
    resumeOn: null,
    sourceDocumentId: 'doc-1',
    sourceProposalId: 'proposal-1',
    recordedInMemoriaAt: '2026-01-01T00:00:00Z',
    recordedAfterQueriedDate: false,
    orphaned: false,
    usedInResolution: true,
    ...overrides,
  }
}

describe('buildEngagementContractHistoryViewModel — Engagement legacy (OS14, aucun effet)', () => {
  it('provenanceTrail vide : isLegacy=true, message explicite, aucune timeline fabriquée', () => {
    const vm = buildEngagementContractHistoryViewModel(baseState({ provenanceTrail: [] }))
    expect(vm.isLegacy).toBe(true)
    expect(vm.legacyMessage).toMatch(/Engagement historique/)
    expect(vm.entries).toEqual([])
  })
})

describe('buildEngagementContractHistoryViewModel — OS15 golden witness', () => {
  it('Cas 1 — MODIFY permanent : scope + valeur structurée + date d’entrée en vigueur', () => {
    const state = baseState({
      scopes: [
        baseScope({
          scopeKey: 'frequency',
          basis: 'modify',
          applicability: 'applicable',
          value: { frequency: { from: '2/semaine', to: '3/semaine' } },
          sourceEffectId: 'os15-modify-1',
        }),
      ],
      provenanceTrail: [
        entry({
          effectId: 'os15-modify-1',
          effect: 'modify',
          scopeKey: 'frequency',
          startsOn: '2026-12-01',
          usedInResolution: true,
        }),
      ],
    })
    const vm = buildEngagementContractHistoryViewModel(state)
    expect(vm.isLegacy).toBe(false)
    expect(vm.entries).toHaveLength(1)
    const [e] = vm.entries
    expect(e.headline).toBe('Modification — frequency')
    expect(e.dateLine).toBe('À partir du 1 décembre 2026.')
    expect(e.valueLine).toBe('frequency : 2/semaine → 3/semaine')
    expect(e.contribution).toBe('used_in_resolution')
    expect(e.contributionNote).toBeNull()
  })

  it('Cas 2 — SUSPEND bornée : fenêtre + reprise, jamais d’indétermination', () => {
    const state = baseState({
      scopes: [baseScope({ scopeKey: 'whole_engagement', applicability: 'suspended' })],
      provenanceTrail: [
        entry({
          effectId: 'os15-suspend-1',
          effect: 'suspend',
          scopeKey: 'whole_engagement',
          temporality: 'bounded',
          startsOn: '2026-12-10',
          endsOn: '2026-12-14',
          resumeOn: '2026-12-15',
        }),
      ],
    })
    const vm = buildEngagementContractHistoryViewModel(state)
    const [e] = vm.entries
    expect(e.headline).toBe('Suspension — whole_engagement')
    expect(e.dateLine).toBe('Suspension du 10 décembre 2026 au 14 décembre 2026. Reprise le 15 décembre 2026.')
    expect(e.engineIndeterminateReason).toBeNull()
  })

  it('Cas 3 — NEW bornée : existence sur toute la fenêtre', () => {
    const state = baseState({
      provenanceTrail: [
        entry({
          effectId: 'os15-new-1',
          effect: 'new',
          scopeKey: 'whole_engagement',
          temporality: 'bounded',
          startsOn: '2026-12-01',
          endsOn: '2027-01-31',
        }),
      ],
    })
    const vm = buildEngagementContractHistoryViewModel(state)
    const [e] = vm.entries
    expect(e.headline).toBe('Engagement en vigueur du 1 décembre 2026 au 31 janvier 2027.')
  })

  it('Cas 4 — CONFIRM : provenance-only, jamais un remplacement de valeur ni un redémarrage de période', () => {
    const state = baseState({
      provenanceTrail: [
        entry({
          effectId: 'os15-confirm-1',
          effect: 'confirm',
          scopeKey: 'whole_engagement',
          startsOn: '2026-12-01',
          sourceDocumentId: 'doc-os15',
          usedInResolution: false,
        }),
      ],
    })
    const vm = buildEngagementContractHistoryViewModel(state, new Map([['doc-os15', 'OS15']]))
    const [e] = vm.entries
    expect(e.headline).toBe('Confirmé par OS15')
    expect(e.contribution).toBe('confirm_provenance_only')
    expect(e.contributionNote).toMatch(/ne modifie jamais une valeur, une existence ni une période/)
  })
})

describe('buildEngagementContractHistoryViewModel — séparation dates contractuelles / MemorIA', () => {
  it('recordedInMemoriaAt jamais présenté comme une date contractuelle, toujours une ligne séparée', () => {
    const state = baseState({
      provenanceTrail: [
        entry({
          effectId: 'e1',
          effect: 'new',
          scopeKey: 'whole_engagement',
          startsOn: '2026-12-01',
          recordedInMemoriaAt: '2026-12-18T00:00:00Z',
        }),
      ],
    })
    const vm = buildEngagementContractHistoryViewModel(state)
    const [e] = vm.entries
    expect(e.headline).toMatch(/1 décembre 2026/)
    expect(e.headline).not.toMatch(/18 décembre 2026/)
    expect(e.recordedInMemoriaLine).toBe('Enregistré dans MemorIA le 18 décembre 2026')
  })

  it('recordedAfterQueriedDate=true : suffixe explicite, jamais fusionné avec la date contractuelle', () => {
    const state = baseState({
      provenanceTrail: [
        entry({
          effectId: 'e1',
          effect: 'confirm',
          scopeKey: 'whole_engagement',
          startsOn: '2026-12-01',
          recordedInMemoriaAt: '2027-01-05T00:00:00Z',
          recordedAfterQueriedDate: true,
        }),
      ],
    })
    const vm = buildEngagementContractHistoryViewModel(state)
    expect(vm.entries[0].recordedInMemoriaLine).toBe('Enregistré dans MemorIA le 5 janvier 2027 (après la date consultée)')
  })
})

describe('buildEngagementContractHistoryViewModel — SUSPEND bornée avec trou de reprise', () => {
  it('resumeOn > endsOn + 1 jour : le trou indéterminé est rendu explicite dans le récit', () => {
    const state = baseState({
      scopes: [baseScope({ scopeKey: 'whole_engagement', applicability: 'suspended' })],
      provenanceTrail: [
        entry({
          effectId: 'suspend-gap-1',
          effect: 'suspend',
          scopeKey: 'whole_engagement',
          temporality: 'bounded',
          startsOn: '2026-12-10',
          endsOn: '2026-12-14',
          resumeOn: '2026-12-19',
        }),
      ],
    })
    const vm = buildEngagementContractHistoryViewModel(state)
    const [e] = vm.entries
    expect(e.dateLine).toBe(
      'Suspension du 10 décembre 2026 au 14 décembre 2026. Reprise le 19 décembre 2026. ' +
        'Statut indéterminé du 15 décembre 2026 au 18 décembre 2026 — aucune règle contractuelle ne couvre cet intervalle.',
    )
  })

  it('resumeOn = endsOn + 1 jour (reprise immédiate) : aucun trou signalé', () => {
    const state = baseState({
      provenanceTrail: [
        entry({
          effectId: 'suspend-clean-1',
          effect: 'suspend',
          scopeKey: 'whole_engagement',
          temporality: 'bounded',
          startsOn: '2026-12-10',
          endsOn: '2026-12-14',
          resumeOn: '2026-12-15',
        }),
      ],
    })
    const vm = buildEngagementContractHistoryViewModel(state)
    expect(vm.entries[0].dateLine).toBe('Suspension du 10 décembre 2026 au 14 décembre 2026. Reprise le 15 décembre 2026.')
    expect(vm.entries[0].dateLine).not.toMatch(/indéterminé/)
  })
})

describe('buildEngagementContractHistoryViewModel — SUSPEND one_off', () => {
  it('affiche uniquement le jour de suspension, sans fenêtre ni reprise', () => {
    const state = baseState({
      provenanceTrail: [
        entry({
          effectId: 'suspend-oneoff-1',
          effect: 'suspend',
          scopeKey: 'whole_engagement',
          temporality: 'one_off',
          startsOn: '2026-12-24',
        }),
      ],
    })
    const vm = buildEngagementContractHistoryViewModel(state)
    expect(vm.entries[0].dateLine).toBe('Suspension le 24 décembre 2026 uniquement.')
  })
})

describe('buildEngagementContractHistoryViewModel — NEW one_off', () => {
  it('décrit une existence limitée au jour unique, jamais une fenêtre ni un scope', () => {
    const state = baseState({
      provenanceTrail: [
        entry({
          effectId: 'new-oneoff-1',
          effect: 'new',
          scopeKey: 'whole_engagement',
          temporality: 'one_off',
          startsOn: '2026-12-24',
        }),
      ],
    })
    const vm = buildEngagementContractHistoryViewModel(state)
    expect(vm.entries[0].headline).toBe('Engagement applicable uniquement le 24 décembre 2026.')
  })
})

describe('buildEngagementContractHistoryViewModel — SUSPEND event_driven indéterminé', () => {
  it('jamais de reprise inventée + motif moteur repris verbatim', () => {
    const reason = 'Statut de reprise non confirmé (fenêtre de reprise explicite non atteinte) ou suspension déclenchée par événement sans mécanisme de clôture démontré.'
    const state = baseState({
      scopes: [
        baseScope({
          scopeKey: 'whole_engagement',
          applicability: 'indeterminate',
          indeterminateReason: reason,
        }),
      ],
      provenanceTrail: [
        entry({
          effectId: 'e1',
          effect: 'suspend',
          scopeKey: 'whole_engagement',
          temporality: 'event_driven',
          startsOn: '2026-12-10',
        }),
      ],
    })
    const vm = buildEngagementContractHistoryViewModel(state)
    const [e] = vm.entries
    expect(e.dateLine).toBe('Suspension déclenchée par événement, reprise non déterminable à partir des données qualifiées.')
    expect(e.engineIndeterminateReason).toBe(reason)
  })
})

describe('buildEngagementContractHistoryViewModel — conflits', () => {
  it('conflit de fondateurs (plusieurs NEW) : message global + entries marquées en conflit', () => {
    const state = baseState({
      existence: { status: 'undetermined', foundedBy: null, existsFrom: null, existsUntil: null },
      resolutionIssue: { type: 'multiple_new_founders', conflictingEffectIds: ['e1', 'e2'] },
      provenanceTrail: [
        entry({ effectId: 'e1', effect: 'new', scopeKey: 'whole_engagement', startsOn: '2026-01-01' }),
        entry({ effectId: 'e2', effect: 'new', scopeKey: 'whole_engagement', startsOn: '2026-01-01' }),
      ],
    })
    const vm = buildEngagementContractHistoryViewModel(state)
    expect(vm.resolutionConflictMessage).toMatch(/Conflit non résolu/)
    expect(vm.entries.every((e) => e.inConflict)).toBe(true)
  })

  it('conflit de valeur sur une même portée (deux MODIFY concurrents) : aucun gagnant choisi', () => {
    const state = baseState({
      scopes: [
        baseScope({
          scopeKey: 'frequency',
          applicability: 'applicable',
          valueConflict: { scopeKey: 'frequency', conflictingEffectIds: ['m1', 'm2'], reason: 'Deux effets concurrents portent sur la fréquence à la même date.' },
        }),
      ],
      provenanceTrail: [
        entry({ effectId: 'm1', effect: 'modify', scopeKey: 'frequency', startsOn: '2026-06-01' }),
        entry({ effectId: 'm2', effect: 'modify', scopeKey: 'frequency', startsOn: '2026-06-01' }),
      ],
    })
    const vm = buildEngagementContractHistoryViewModel(state)
    expect(vm.entries.every((e) => e.inConflict)).toBe(true)
    expect(vm.entries.every((e) => e.conflictReason === 'Deux effets concurrents portent sur la fréquence à la même date.')).toBe(true)
    // Aucune des deux entrées n'affiche une valeur — pas de gagnant fabriqué ici.
    expect(vm.entries.every((e) => e.valueLine === null)).toBe(true)
  })
})

describe('buildEngagementContractHistoryViewModel — plusieurs portées indépendantes', () => {
  it('chaque portée affiche sa propre valeur, sans interférence', () => {
    const state = baseState({
      scopes: [
        baseScope({ scopeKey: 'frequency', basis: 'modify', value: { frequency: { from: '2/semaine', to: '3/semaine' } }, sourceEffectId: 'm-freq' }),
        baseScope({ scopeKey: 'duree', basis: 'modify', value: { duree: { from: '1h', to: '2h' } }, sourceEffectId: 'm-duree' }),
      ],
      provenanceTrail: [
        entry({ effectId: 'm-freq', effect: 'modify', scopeKey: 'frequency', startsOn: '2026-02-01' }),
        entry({ effectId: 'm-duree', effect: 'modify', scopeKey: 'duree', startsOn: '2026-03-01' }),
      ],
    })
    const vm = buildEngagementContractHistoryViewModel(state)
    const freq = vm.entries.find((e) => e.effectId === 'm-freq')!
    const duree = vm.entries.find((e) => e.effectId === 'm-duree')!
    expect(freq.valueLine).toBe('frequency : 2/semaine → 3/semaine')
    expect(duree.valueLine).toBe('duree : 1h → 2h')
  })
})

describe('buildEngagementContractHistoryViewModel — ordre historique', () => {
  it('trie par date contractuelle (startsOn), jamais par recordedInMemoriaAt', () => {
    const state = baseState({
      provenanceTrail: [
        // Enregistré EN DERNIER dans MemorIA mais contractuellement le PREMIER effet.
        entry({ effectId: 'first', effect: 'new', scopeKey: 'whole_engagement', startsOn: '2026-01-01', recordedInMemoriaAt: '2026-12-01T00:00:00Z' }),
        entry({ effectId: 'second', effect: 'modify', scopeKey: 'frequency', startsOn: '2026-03-01', recordedInMemoriaAt: '2026-01-05T00:00:00Z' }),
        entry({ effectId: 'third', effect: 'modify', scopeKey: 'frequency', startsOn: '2026-06-01', recordedInMemoriaAt: '2026-01-01T00:00:00Z' }),
      ],
    })
    const vm = buildEngagementContractHistoryViewModel(state)
    expect(vm.entries.map((e) => e.effectId)).toEqual(['first', 'second', 'third'])
  })

  it('permanent → override borné → retour permanent : ordre visuel suit les dates de prise d’effet', () => {
    const state = baseState({
      provenanceTrail: [
        entry({ effectId: 'permanent-base', effect: 'new', scopeKey: 'whole_engagement', startsOn: '2026-01-01' }),
        entry({ effectId: 'bounded-override', effect: 'modify', scopeKey: 'frequency', temporality: 'bounded', startsOn: '2026-06-01', endsOn: '2026-06-30' }),
        entry({ effectId: 'permanent-resume', effect: 'modify', scopeKey: 'frequency', startsOn: '2026-07-01' }),
      ],
    })
    const vm = buildEngagementContractHistoryViewModel(state)
    expect(vm.entries.map((e) => e.effectId)).toEqual(['permanent-base', 'bounded-override', 'permanent-resume'])
  })
})

describe('buildEngagementContractHistoryViewModel — visibilité documentaire (sécurité)', () => {
  it('document visible dans documentTitleById : titre affiché', () => {
    const state = baseState({
      provenanceTrail: [entry({ effectId: 'e1', effect: 'modify', scopeKey: 'frequency', startsOn: '2026-01-01', sourceDocumentId: 'doc-visible' })],
    })
    const vm = buildEngagementContractHistoryViewModel(state, new Map([['doc-visible', 'OS15']]))
    expect(vm.entries[0].sourceLine).toBe('Source : OS15')
  })

  it('document absent de documentTitleById (non visible pour ce rôle) : mention neutre, UUID jamais exposé', () => {
    const state = baseState({
      provenanceTrail: [entry({ effectId: 'e1', effect: 'modify', scopeKey: 'frequency', startsOn: '2026-01-01', sourceDocumentId: 'doc-hidden-uuid-1234' })],
    })
    const vm = buildEngagementContractHistoryViewModel(state, new Map([['doc-visible', 'OS15']]))
    const [e] = vm.entries
    expect(e.sourceLine).toBe('Source : document à accès restreint')
    const serialized = JSON.stringify(e)
    expect(serialized).not.toContain('doc-hidden-uuid-1234')
  })

  it('aucune documentTitleById fournie : mention neutre par défaut, jamais l’id brut', () => {
    const state = baseState({
      provenanceTrail: [entry({ effectId: 'e1', effect: 'confirm', scopeKey: 'whole_engagement', startsOn: '2026-01-01', sourceDocumentId: 'doc-raw-id' })],
    })
    const vm = buildEngagementContractHistoryViewModel(state)
    const [e] = vm.entries
    expect(e.sourceLine).toBe('Source : document à accès restreint')
    expect(e.headline).toBe('Confirmation documentaire enregistrée')
    expect(JSON.stringify(e)).not.toContain('doc-raw-id')
  })
})

describe('buildEngagementContractHistoryViewModel — contribution / orphelin', () => {
  it('effet orphelin (hors fenêtre NEW) : signalé explicitement, jamais fusionné avec les effets actifs', () => {
    const state = baseState({
      provenanceTrail: [entry({ effectId: 'e1', effect: 'modify', scopeKey: 'frequency', startsOn: '2026-01-01', orphaned: true, usedInResolution: false })],
    })
    const vm = buildEngagementContractHistoryViewModel(state)
    const [e] = vm.entries
    expect(e.contribution).toBe('orphaned')
    expect(e.contributionNote).toMatch(/hors de la fenêtre d'existence/)
  })

  it('effet non retenu (remplacé/futur) sans être orphelin ni conflit : note distincte', () => {
    const state = baseState({
      provenanceTrail: [entry({ effectId: 'e1', effect: 'modify', scopeKey: 'frequency', startsOn: '2026-01-01', orphaned: false, usedInResolution: false })],
    })
    const vm = buildEngagementContractHistoryViewModel(state)
    expect(vm.entries[0].contribution).toBe('not_used_in_resolution')
  })
})
