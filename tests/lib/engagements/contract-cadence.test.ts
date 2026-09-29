// DOC-CONTRACT-OS-1B4-B0 (mandat Vincent 2026-09-30) — tests purs de la brique
// contractuelle structurée de cadence (lib/engagements/contract-cadence.ts).
// Témoin OS15 : NEW 1/semaine, MODIFY 2/semaine→3/semaine, SUSPEND avec
// cadence structurée préexistante, CONFIRM sans mutation de cadence. Aucun
// accès DB — même discipline que resolve-contract-state.test.ts.

import { describe, it, expect } from 'vitest'
import {
  isValidCadence,
  buildCadenceEffectPayloadFragment,
  extractCadenceFromEffectPayload,
  resolveContractCadenceAtDate,
} from '@/lib/engagements/contract-cadence'
import { resolveEngagementAtDate } from '@/lib/engagements/resolve-contract-state'
import type { EngagementContractEffectRow, MaterializedContractEffect } from '@/lib/engagements/resolve-contract-state'
import type { ContractTemporality } from '@/lib/engagements/contract-effect'

function row(
  overrides: Partial<EngagementContractEffectRow> & { id: string; effect: MaterializedContractEffect },
): EngagementContractEffectRow {
  return {
    engagementId: 'eng-os15',
    temporality: 'permanent' as ContractTemporality,
    scopeKey: 'whole_engagement',
    effectPayload: {},
    startsOn: null,
    endsOn: null,
    resumeOn: null,
    sourceDocumentId: 'doc-os15',
    sourceProposalId: 'prop-os15',
    appliedAt: '2026-09-30T00:00:00Z',
    ...overrides,
  }
}

describe('isValidCadence', () => {
  it('accepte {count, period} avec un entier strictement positif et une période connue', () => {
    expect(isValidCadence({ count: 1, period: 'week' })).toBe(true)
    expect(isValidCadence({ count: 2, period: 'week' })).toBe(true)
    expect(isValidCadence({ count: 3, period: 'week' })).toBe(true)
    expect(isValidCadence({ count: 4, period: 'day' })).toBe(true)
    expect(isValidCadence({ count: 1, period: 'month' })).toBe(true)
  })

  it('rejette count non entier, nul, négatif ou fourni en chaîne', () => {
    expect(isValidCadence({ count: 0, period: 'week' })).toBe(false)
    expect(isValidCadence({ count: -1, period: 'week' })).toBe(false)
    expect(isValidCadence({ count: 1.5, period: 'week' })).toBe(false)
    expect(isValidCadence({ count: '2', period: 'week' })).toBe(false)
  })

  it('rejette une période hors vocabulaire fini', () => {
    expect(isValidCadence({ count: 1, period: 'hebdomadaire' })).toBe(false)
    expect(isValidCadence({ count: 1, period: '' })).toBe(false)
  })

  it('rejette une valeur absente, null ou non-objet', () => {
    expect(isValidCadence(undefined)).toBe(false)
    expect(isValidCadence(null)).toBe(false)
    expect(isValidCadence('1 fois par semaine')).toBe(false)
    expect(isValidCadence(42)).toBe(false)
  })
})

describe('buildCadenceEffectPayloadFragment', () => {
  it('produit un fragment { cadence } isolé, fusionnable avec une description', () => {
    expect(buildCadenceEffectPayloadFragment({ count: 1, period: 'week' })).toEqual({ cadence: { count: 1, period: 'week' } })
  })
})

describe('extractCadenceFromEffectPayload', () => {
  it('lit la cadence structurée quand présente', () => {
    expect(extractCadenceFromEffectPayload({ cadence: { count: 2, period: 'week' } })).toEqual({ count: 2, period: 'week' })
  })

  it('rend null en l\'absence de clé cadence, même avec description/frequency_raw/source_excerpt/label présents', () => {
    expect(extractCadenceFromEffectPayload({
      description: 'un relevé photo sera effectué une fois par semaine',
      frequency_raw: 'hebdomadaire',
      source_excerpt: 'Le prestataire effectuera un relevé chaque semaine',
      label: 'Fréquence hebdomadaire',
    })).toBeNull()
  })

  it('ne lit jamais description/frequency_raw/source_excerpt/label pour fabriquer une cadence, même si cadence est malformée', () => {
    expect(extractCadenceFromEffectPayload({
      cadence: { count: '2', period: 'semaine' },
      description: '2 fois par semaine',
    })).toBeNull()
  })

  it('rend null pour un payload vide, null ou absent', () => {
    expect(extractCadenceFromEffectPayload({})).toBeNull()
    expect(extractCadenceFromEffectPayload(null)).toBeNull()
    expect(extractCadenceFromEffectPayload(undefined)).toBeNull()
  })
})

describe('resolveContractCadenceAtDate — témoin structuré OS15', () => {
  const os15New = row({
    id: 'os15-new',
    effect: 'new',
    temporality: 'bounded',
    scopeKey: 'whole_engagement',
    startsOn: '2026-12-01',
    endsOn: '2027-01-31',
    effectPayload: { description: 'Relevé photo', cadence: { count: 1, period: 'week' } },
  })

  it('NEW seul — cadence structurée du fondateur retrouvée SANS lire une description texte', () => {
    const state = resolveEngagementAtDate({ engagementId: 'eng-os15', effects: [os15New] }, '2026-12-15')
    expect(resolveContractCadenceAtDate([os15New], state)).toEqual({ count: 1, period: 'week' })
  })

  it('NEW seul — hors fenêtre d\'existence (avant startsOn), aucune cadence retournée', () => {
    const state = resolveEngagementAtDate({ engagementId: 'eng-os15', effects: [os15New] }, '2026-11-01')
    expect(resolveContractCadenceAtDate([os15New], state)).toBeNull()
  })

  it('MODIFY — 2/semaine puis 3/semaine à effectiveFrom, la valeur structurée AVANT est retrouvable', () => {
    const modifyTo2 = row({
      id: 'os15-mod-2',
      effect: 'modify',
      scopeKey: 'frequency',
      startsOn: '2026-12-01',
      endsOn: null,
      effectPayload: { cadence: { count: 2, period: 'week' } },
    })
    const effects = [os15New, modifyTo2]
    const state = resolveEngagementAtDate({ engagementId: 'eng-os15', effects }, '2026-12-20')
    expect(resolveContractCadenceAtDate(effects, state)).toEqual({ count: 2, period: 'week' })
  })

  it('MODIFY — 3/semaine gagnant à la date interrogée (OS14 textuel non rejoué, pas de backfill)', () => {
    const modifyTo2 = row({
      id: 'os15-mod-2',
      effect: 'modify',
      scopeKey: 'frequency',
      startsOn: '2026-12-01',
      endsOn: null,
      effectPayload: { cadence: { count: 2, period: 'week' } },
    })
    const modifyTo3 = row({
      id: 'os15-mod-3',
      effect: 'modify',
      scopeKey: 'frequency',
      startsOn: '2026-12-15',
      endsOn: null,
      effectPayload: { cadence: { count: 3, period: 'week' } },
    })
    const effects = [os15New, modifyTo2, modifyTo3]
    const beforeState = resolveEngagementAtDate({ engagementId: 'eng-os15', effects }, '2026-12-10')
    const afterState = resolveEngagementAtDate({ engagementId: 'eng-os15', effects }, '2026-12-20')
    expect(resolveContractCadenceAtDate(effects, beforeState)).toEqual({ count: 2, period: 'week' })
    expect(resolveContractCadenceAtDate(effects, afterState)).toEqual({ count: 3, period: 'week' })
  })

  it('SUSPEND — la cadence structurée préexistante reste retrouvable juste avant le début de la suspension', () => {
    const modifyTo2 = row({
      id: 'os15-mod-2',
      effect: 'modify',
      scopeKey: 'frequency',
      startsOn: '2026-12-01',
      endsOn: null,
      effectPayload: { cadence: { count: 2, period: 'week' } },
    })
    const suspend = row({
      id: 'os15-suspend',
      effect: 'suspend',
      scopeKey: 'whole_engagement',
      temporality: 'bounded',
      startsOn: '2026-12-10',
      endsOn: '2026-12-14',
      resumeOn: '2026-12-15',
    })
    const effects = [os15New, modifyTo2, suspend]
    // La question Planning future (1B4-B, hors périmètre ici) est : « juste
    // avant le début de la suspension, l'Engagement possédait-il une cadence
    // contractuelle structurée ? » — jamais une cadence copiée dans le
    // payload SUSPEND lui-même (mandat, section 6).
    const dayBeforeSuspend = resolveEngagementAtDate({ engagementId: 'eng-os15', effects }, '2026-12-09')
    expect(resolveContractCadenceAtDate(effects, dayBeforeSuspend)).toEqual({ count: 2, period: 'week' })
    expect(suspend.effectPayload).toEqual({})
  })

  it('CONFIRM — n\'introduit et ne mute jamais de cadence, la cadence NEW reste inchangée', () => {
    const confirm = row({
      id: 'os15-confirm',
      effect: 'confirm',
      scopeKey: 'whole_engagement',
      startsOn: '2026-12-20',
      effectPayload: {},
    })
    const effects = [os15New, confirm]
    const state = resolveEngagementAtDate({ engagementId: 'eng-os15', effects }, '2026-12-20')
    expect(resolveContractCadenceAtDate(effects, state)).toEqual({ count: 1, period: 'week' })
  })

  it('legacy — aucun effet NEW (Engagement pré-1B1), cadence toujours null, jamais devinée', () => {
    const state = resolveEngagementAtDate({ engagementId: 'eng-legacy', effects: [] }, '2026-12-20')
    expect(state.existence.status).toBe('exists')
    expect(resolveContractCadenceAtDate([], state)).toBeNull()
  })

  it('conflit MODIFY — deux effets simultanés sur frequency, cadence rendue null (indéterminé prime sur invention)', () => {
    const conflictA = row({ id: 'os15-conf-a', effect: 'modify', scopeKey: 'frequency', startsOn: '2026-12-05', endsOn: null, effectPayload: { cadence: { count: 2, period: 'week' } } })
    const conflictB = row({ id: 'os15-conf-b', effect: 'modify', scopeKey: 'frequency', startsOn: '2026-12-05', endsOn: null, effectPayload: { cadence: { count: 3, period: 'week' } } })
    const effects = [os15New, conflictA, conflictB]
    const state = resolveEngagementAtDate({ engagementId: 'eng-os15', effects }, '2026-12-20')
    expect(resolveContractCadenceAtDate(effects, state)).toBeNull()
  })
})
