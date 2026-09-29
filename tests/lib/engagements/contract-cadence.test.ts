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
  isCadenceAllowedForEffect,
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

// FIX_REQUIRED 1B4-B0 (revue Vincent 2026-09-30, FIX 2) : le vrai témoin OS15
// est CAS A ci-dessous (MODIFY Z1, transition exactement le 2026-12-01) — pas
// un scénario qui mélange un NEW et un MODIFY sous le même engagementId, ni
// une transition déplacée au 12-15. Chaque cas ci-dessous porte sur un
// Engagement distinct : jamais deux scénarios sous le même engagementId.
describe('resolveContractCadenceAtDate — OS15, 4 cas indépendants (CAS A-D)', () => {
  it('CAS A — MODIFY Z1 : 2/semaine → 3/semaine exactement à partir du 2026-12-01 (le vrai témoin OS15)', () => {
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
    const before = resolveEngagementAtDate({ engagementId: 'eng-z1', effects }, '2026-11-30')
    const atTransition = resolveEngagementAtDate({ engagementId: 'eng-z1', effects }, '2026-12-01')
    expect(resolveContractCadenceAtDate(effects, before)).toEqual({ count: 2, period: 'week' })
    expect(resolveContractCadenceAtDate(effects, atTransition)).toEqual({ count: 3, period: 'week' })
  })

  it('CAS B — NEW indépendant (relevé photo) : 1/semaine du 2026-12-01 au 2027-01-31, jamais lu depuis description', () => {
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
    const effects = [releve]
    const before = resolveEngagementAtDate({ engagementId: 'eng-releve-photo', effects }, '2026-11-30')
    const start = resolveEngagementAtDate({ engagementId: 'eng-releve-photo', effects }, '2026-12-01')
    const end = resolveEngagementAtDate({ engagementId: 'eng-releve-photo', effects }, '2027-01-31')
    const after = resolveEngagementAtDate({ engagementId: 'eng-releve-photo', effects }, '2027-02-01')
    expect(resolveContractCadenceAtDate(effects, before)).toBeNull()
    expect(resolveContractCadenceAtDate(effects, start)).toEqual({ count: 1, period: 'week' })
    expect(resolveContractCadenceAtDate(effects, end)).toEqual({ count: 1, period: 'week' })
    expect(resolveContractCadenceAtDate(effects, after)).toBeNull()
  })

  it('CAS C — SUSPEND Z4 : la cadence préexistante n\'est jamais copiée dans le payload SUSPEND', () => {
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
    // Question Planning future (1B4-B, hors périmètre ici) : « juste avant le
    // début de la suspension, l'Engagement possédait-il une cadence
    // structurée ? » — jamais une cadence copiée dans le payload SUSPEND
    // lui-même (mandat, section 6).
    const dayBeforeSuspend = resolveEngagementAtDate({ engagementId: 'eng-z4', effects }, '2026-12-09')
    expect(resolveContractCadenceAtDate(effects, dayBeforeSuspend)).toEqual({ count: 2, period: 'week' })
    expect(suspend.effectPayload).toEqual({})
    expect('cadence' in suspend.effectPayload).toBe(false)
  })

  it('CAS D — CONFIRM sur Engagement indépendant : n\'introduit et ne mute jamais de cadence', () => {
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
    expect(resolveContractCadenceAtDate(effects, state)).toEqual({ count: 1, period: 'week' })
    expect(confirm.effectPayload).toEqual({})
  })

  it('legacy — aucun effet NEW (Engagement pré-1B1), cadence toujours null, jamais devinée', () => {
    const state = resolveEngagementAtDate({ engagementId: 'eng-legacy', effects: [] }, '2026-12-20')
    expect(state.existence.status).toBe('exists')
    expect(resolveContractCadenceAtDate([], state)).toBeNull()
  })

  it('conflit MODIFY — deux effets simultanés sur frequency, cadence rendue null (indéterminé prime sur invention)', () => {
    const founder = row({
      id: 'conf-new',
      engagementId: 'eng-conflit',
      effect: 'new',
      temporality: 'permanent',
      scopeKey: 'whole_engagement',
      startsOn: '2026-01-01',
      endsOn: null,
      effectPayload: { cadence: { count: 1, period: 'week' } },
    })
    const conflictA = row({ id: 'conf-a', engagementId: 'eng-conflit', effect: 'modify', scopeKey: 'frequency', startsOn: '2026-12-05', endsOn: null, effectPayload: { cadence: { count: 2, period: 'week' } } })
    const conflictB = row({ id: 'conf-b', engagementId: 'eng-conflit', effect: 'modify', scopeKey: 'frequency', startsOn: '2026-12-05', endsOn: null, effectPayload: { cadence: { count: 3, period: 'week' } } })
    const effects = [founder, conflictA, conflictB]
    const state = resolveEngagementAtDate({ engagementId: 'eng-conflit', effects }, '2026-12-20')
    expect(resolveContractCadenceAtDate(effects, state)).toBeNull()
  })
})

// FIX_REQUIRED 1B4-B0 (revue Vincent 2026-09-30, FIX 1) : invariant SERVEUR —
// une cadence structurée n'est jamais acceptée en dehors de NEW ou
// MODIFY+frequency, même si le FormData est forgé en contournant l'UI
// (setContractEffectAction délègue explicitement à cette même fonction pure).
describe('isCadenceAllowedForEffect — invariant serveur FIX 1', () => {
  it('NEW + cadence → autorisé, quel que soit scope_key', () => {
    expect(isCadenceAllowedForEffect('new', null)).toBe(true)
    expect(isCadenceAllowedForEffect('new', 'whole_engagement')).toBe(true)
  })

  it('MODIFY + scope_key frequency → autorisé', () => {
    expect(isCadenceAllowedForEffect('modify', 'frequency')).toBe(true)
  })

  it('MODIFY + scope_key quantity (ou tout autre scope non-frequency) → refusé', () => {
    expect(isCadenceAllowedForEffect('modify', 'quantity')).toBe(false)
    expect(isCadenceAllowedForEffect('modify', 'whole_engagement')).toBe(false)
    expect(isCadenceAllowedForEffect('modify', null)).toBe(false)
  })

  it('SUSPEND + cadence → refusé', () => {
    expect(isCadenceAllowedForEffect('suspend', 'whole_engagement')).toBe(false)
    expect(isCadenceAllowedForEffect('suspend', 'frequency')).toBe(false)
  })

  it('CONFIRM + cadence → refusé', () => {
    expect(isCadenceAllowedForEffect('confirm', 'whole_engagement')).toBe(false)
    expect(isCadenceAllowedForEffect('confirm', null)).toBe(false)
  })

  it('CONFLICT / NON_ENGAGEMENT + cadence → refusé', () => {
    expect(isCadenceAllowedForEffect('conflict', 'frequency')).toBe(false)
    expect(isCadenceAllowedForEffect('non_engagement', 'frequency')).toBe(false)
  })
})
