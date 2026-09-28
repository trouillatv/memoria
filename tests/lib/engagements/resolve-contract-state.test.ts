// DOC-CONTRACT-OS-1B2-B1 (mandat Vincent 2026-09-29) — matrice de tests du
// moteur pur resolveEngagementAtDate. Chaque cas correspond à un point de
// doctrine gelé par l'audit DOC-CONTRACT-OS-1B2-A (voir l'en-tête de
// resolve-contract-state.ts pour la numérotation des doctrines 1-9).

import { describe, it, expect } from 'vitest'
import { resolveEngagementAtDate } from '@/lib/engagements/resolve-contract-state'
import type {
  EngagementContractEffectRow,
  MaterializedContractEffect,
} from '@/lib/engagements/resolve-contract-state'
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

describe('resolveEngagementAtDate — legacy (sans NEW)', () => {
  it('Engagement sans aucun effet — existe toujours, base textuelle, valeur null', () => {
    const dto = resolveEngagementAtDate({ engagementId: 'eng-1', effects: [] }, '2026-06-01')
    expect(dto.resolvable).toBe(true)
    expect(dto.existence).toEqual({ status: 'exists', foundedBy: null, existsFrom: null, existsUntil: null })
    expect(dto.scopes).toEqual([
      {
        scopeKey: 'whole_engagement',
        applicability: 'applicable',
        dominatedByWholeEngagementSuspend: false,
        basis: 'engagement_base',
        value: null,
        sourceEffectId: null,
        valueConflict: null,
        applicabilityConflict: null,
        indeterminateReason: null,
      },
    ])
  })

  it('Engagement legacy avec un premier MODIFY — bascule sur la valeur repliée', () => {
    const mod = row({
      id: 'mod-legacy',
      effect: 'modify',
      scopeKey: 'lot_a',
      startsOn: '2026-02-01',
      effectPayload: { price: 42 },
    })
    const dto = resolveEngagementAtDate({ engagementId: 'eng-1', effects: [mod] }, '2026-06-01')
    expect(dto.existence.status).toBe('exists')
    const scope = dto.scopes.find((s) => s.scopeKey === 'lot_a')
    expect(scope?.basis).toBe('modify')
    expect(scope?.value).toEqual({ price: 42 })
    expect(scope?.sourceEffectId).toBe('mod-legacy')
  })
})

describe('resolveEngagementAtDate — NEW fixe l’existence de l’Engagement (doctrine 1)', () => {
  it('NEW permanent — ouvert dès startsOn, jamais expiré', () => {
    const founder = row({ id: 'new-perm', effect: 'new', temporality: 'permanent', startsOn: '2026-01-01' })
    const before = resolveEngagementAtDate({ engagementId: 'eng-1', effects: [founder] }, '2025-12-31')
    expect(before.existence).toEqual({
      status: 'not_yet_existing',
      foundedBy: 'new-perm',
      existsFrom: '2026-01-01',
      existsUntil: null,
    })
    expect(before.scopes).toEqual([])

    const after = resolveEngagementAtDate({ engagementId: 'eng-1', effects: [founder] }, '2030-01-01')
    expect(after.existence.status).toBe('exists')
    expect(after.existence.existsUntil).toBeNull()
  })

  it('NEW bounded — fenêtre [A,B] fermée définitivement à l’expiration', () => {
    const founder = row({
      id: 'new-bounded',
      effect: 'new',
      temporality: 'bounded',
      startsOn: '2026-02-01',
      endsOn: '2026-02-28',
    })
    const before = resolveEngagementAtDate({ engagementId: 'eng-1', effects: [founder] }, '2026-01-15')
    expect(before.existence.status).toBe('not_yet_existing')

    const within = resolveEngagementAtDate({ engagementId: 'eng-1', effects: [founder] }, '2026-02-15')
    expect(within.existence.status).toBe('exists')

    const after = resolveEngagementAtDate({ engagementId: 'eng-1', effects: [founder] }, '2026-03-15')
    expect(after.existence).toEqual({
      status: 'expired',
      foundedBy: 'new-bounded',
      existsFrom: '2026-02-01',
      existsUntil: '2026-02-28',
    })
    expect(after.scopes).toEqual([])
  })

  it('NEW one_off — n’existe que le jour même', () => {
    const founder = row({ id: 'new-oneoff', effect: 'new', temporality: 'one_off', startsOn: '2026-05-10' })
    expect(resolveEngagementAtDate({ engagementId: 'eng-1', effects: [founder] }, '2026-05-09').existence.status).toBe(
      'not_yet_existing',
    )
    expect(resolveEngagementAtDate({ engagementId: 'eng-1', effects: [founder] }, '2026-05-10').existence.status).toBe(
      'exists',
    )
    expect(resolveEngagementAtDate({ engagementId: 'eng-1', effects: [founder] }, '2026-05-11').existence.status).toBe(
      'expired',
    )
  })

  it('NEW event_driven — ouvert dès startsOn, jamais expiré (comme permanent)', () => {
    const founder = row({ id: 'new-event', effect: 'new', temporality: 'event_driven', startsOn: '2026-01-01' })
    const dto = resolveEngagementAtDate({ engagementId: 'eng-1', effects: [founder] }, '2030-01-01')
    expect(dto.existence).toEqual({
      status: 'exists',
      foundedBy: 'new-event',
      existsFrom: '2026-01-01',
      existsUntil: null,
    })
  })

  it('plusieurs NEW pour le même Engagement — conflit explicite, existence indécidable (doctrine 9)', () => {
    const newA = row({ id: 'new-a', effect: 'new', temporality: 'permanent', startsOn: '2026-01-01' })
    const newB = row({ id: 'new-b', effect: 'new', temporality: 'permanent', startsOn: '2026-02-01' })
    const dto = resolveEngagementAtDate({ engagementId: 'eng-1', effects: [newA, newB] }, '2026-06-01')
    expect(dto.resolvable).toBe(false)
    expect(dto.resolutionIssue).toEqual({
      type: 'multiple_new_founders',
      conflictingEffectIds: ['new-a', 'new-b'],
    })
    expect(dto.existence).toEqual({ status: 'undetermined', foundedBy: null, existsFrom: null, existsUntil: null })
    expect(dto.scopes).toEqual([])
    expect(dto.anomalies).toEqual([
      {
        type: 'multiple_new_founders',
        message: 'Plusieurs effets NEW existent pour cet Engagement — existence indécidable.',
        effectIds: ['new-a', 'new-b'],
      },
    ])
    expect(dto.provenanceTrail.every((p) => p.usedInResolution === false)).toBe(true)
  })
})

describe('resolveEngagementAtDate — repli MODIFY (doctrine 4 et 5)', () => {
  const founder = row({ id: 'new-1', effect: 'new', temporality: 'permanent', startsOn: '2026-01-01' })

  it('accumulation de MODIFY permanents — le plus récent démarré gagne', () => {
    const mod1 = row({
      id: 'mod-1',
      effect: 'modify',
      scopeKey: 'lot_a',
      startsOn: '2026-01-01',
      effectPayload: { price: 100 },
    })
    const mod2 = row({
      id: 'mod-2',
      effect: 'modify',
      scopeKey: 'lot_a',
      startsOn: '2026-06-01',
      effectPayload: { price: 120 },
    })
    const early = resolveEngagementAtDate({ engagementId: 'eng-1', effects: [founder, mod1, mod2] }, '2026-03-01')
    const scopeEarly = early.scopes.find((s) => s.scopeKey === 'lot_a')
    expect(scopeEarly).toMatchObject({ basis: 'modify', value: { price: 100 }, sourceEffectId: 'mod-1' })

    const late = resolveEngagementAtDate({ engagementId: 'eng-1', effects: [founder, mod1, mod2] }, '2026-08-01')
    const scopeLate = late.scopes.find((s) => s.scopeKey === 'lot_a')
    expect(scopeLate).toMatchObject({ basis: 'modify', value: { price: 120 }, sourceEffectId: 'mod-2' })
  })

  it('bounded override temporaire puis retour à la DERNIÈRE valeur permanente à l’expiration', () => {
    const mod1 = row({
      id: 'mod-1',
      effect: 'modify',
      scopeKey: 'lot_a',
      startsOn: '2026-01-01',
      effectPayload: { price: 100 },
    })
    const mod2 = row({
      id: 'mod-2',
      effect: 'modify',
      scopeKey: 'lot_a',
      startsOn: '2026-06-01',
      effectPayload: { price: 120 },
    })
    const mod3 = row({
      id: 'mod-3',
      effect: 'modify',
      temporality: 'bounded',
      scopeKey: 'lot_a',
      startsOn: '2026-04-01',
      endsOn: '2026-04-30',
      effectPayload: { price: 999 },
    })
    const effects = [founder, mod1, mod2, mod3]

    const during = resolveEngagementAtDate({ engagementId: 'eng-1', effects }, '2026-04-15')
    expect(during.scopes.find((s) => s.scopeKey === 'lot_a')).toMatchObject({
      basis: 'modify',
      value: { price: 999 },
      sourceEffectId: 'mod-3',
    })

    const afterExpiry = resolveEngagementAtDate({ engagementId: 'eng-1', effects }, '2026-05-15')
    expect(afterExpiry.scopes.find((s) => s.scopeKey === 'lot_a')).toMatchObject({
      basis: 'modify',
      value: { price: 100 },
      sourceEffectId: 'mod-1',
    })

    const laterPermanent = resolveEngagementAtDate({ engagementId: 'eng-1', effects }, '2026-08-01')
    expect(laterPermanent.scopes.find((s) => s.scopeKey === 'lot_a')).toMatchObject({
      basis: 'modify',
      value: { price: 120 },
      sourceEffectId: 'mod-2',
    })
  })

  it('deux MODIFY au même startsOn sur la même portée — CONFLICT, jamais un tie-break technique', () => {
    const modX = row({
      id: 'mod-x',
      effect: 'modify',
      scopeKey: 'lot_b',
      startsOn: '2026-01-01',
      effectPayload: { a: 1 },
      appliedAt: '2026-01-01T08:00:00Z',
    })
    const modY = row({
      id: 'mod-y',
      effect: 'modify',
      scopeKey: 'lot_b',
      startsOn: '2026-01-01',
      effectPayload: { a: 2 },
      appliedAt: '2026-01-01T09:00:00Z',
    })
    const dto = resolveEngagementAtDate({ engagementId: 'eng-1', effects: [founder, modX, modY] }, '2026-02-01')
    const scope = dto.scopes.find((s) => s.scopeKey === 'lot_b')
    expect(scope?.basis).toBe('new')
    expect(scope?.value).toBeNull()
    expect(scope?.valueConflict).toEqual({
      scopeKey: 'lot_b',
      conflictingEffectIds: ['mod-x', 'mod-y'],
      reason: 'Plusieurs effets MODIFY applicables simultanément sur cette portée — aucune valeur ne peut être retenue.',
    })
  })

  it('deux fenêtres bounded qui se chevauchent sur la même portée — CONFLICT', () => {
    const modP = row({
      id: 'mod-p',
      effect: 'modify',
      temporality: 'bounded',
      scopeKey: 'lot_c',
      startsOn: '2026-01-01',
      endsOn: '2026-01-31',
      effectPayload: { a: 1 },
    })
    const modQ = row({
      id: 'mod-q',
      effect: 'modify',
      temporality: 'bounded',
      scopeKey: 'lot_c',
      startsOn: '2026-01-15',
      endsOn: '2026-02-15',
      effectPayload: { a: 2 },
    })
    const dto = resolveEngagementAtDate({ engagementId: 'eng-1', effects: [founder, modP, modQ] }, '2026-01-20')
    const scope = dto.scopes.find((s) => s.scopeKey === 'lot_c')
    expect(scope?.valueConflict?.conflictingEffectIds).toEqual(['mod-p', 'mod-q'])
  })
})

describe('resolveEngagementAtDate — SUSPEND applicabilité (doctrine 6 et 7)', () => {
  const founder = row({ id: 'new-1', effect: 'new', temporality: 'permanent', startsOn: '2026-01-01' })

  it('SUSPEND event_driven — jamais rapportée "suspended" (fausse certitude), toujours indeterminate', () => {
    const susp = row({
      id: 'susp-ev',
      effect: 'suspend',
      temporality: 'event_driven',
      startsOn: '2026-03-01',
    })
    const before = resolveEngagementAtDate({ engagementId: 'eng-1', effects: [founder, susp] }, '2026-02-01')
    const scopeBefore = before.scopes.find((s) => s.scopeKey === 'whole_engagement')
    expect(scopeBefore?.applicability).toBe('applicable')

    for (const date of ['2026-03-01', '2030-01-01']) {
      const dto = resolveEngagementAtDate({ engagementId: 'eng-1', effects: [founder, susp] }, date)
      const scope = dto.scopes.find((s) => s.scopeKey === 'whole_engagement')
      expect(scope?.applicability).toBe('indeterminate')
    }
  })

  it('SUSPEND bounded active — suspended', () => {
    const susp = row({
      id: 'susp-b',
      effect: 'suspend',
      temporality: 'bounded',
      startsOn: '2026-02-01',
      endsOn: '2026-02-28',
    })
    const during = resolveEngagementAtDate({ engagementId: 'eng-1', effects: [founder, susp] }, '2026-02-15')
    expect(during.scopes.find((s) => s.scopeKey === 'whole_engagement')?.applicability).toBe('suspended')
  })

  it('SUSPEND bounded sans resume_on — reprise automatique le lendemain de ends_on', () => {
    const susp = row({
      id: 'susp-b',
      effect: 'suspend',
      temporality: 'bounded',
      startsOn: '2026-02-01',
      endsOn: '2026-02-28',
    })
    const after = resolveEngagementAtDate({ engagementId: 'eng-1', effects: [founder, susp] }, '2026-03-01')
    expect(after.scopes.find((s) => s.scopeKey === 'whole_engagement')?.applicability).toBe('applicable')
  })

  it('SUSPEND bounded avec resume_on > ends_on+1 — trou strict marqué indeterminate, jamais applicable par défaut', () => {
    const susp = row({
      id: 'susp-g',
      effect: 'suspend',
      temporality: 'bounded',
      startsOn: '2026-02-01',
      endsOn: '2026-02-28',
      resumeOn: '2026-03-15',
    })
    const inGap = resolveEngagementAtDate({ engagementId: 'eng-1', effects: [founder, susp] }, '2026-03-05')
    const scopeInGap = inGap.scopes.find((s) => s.scopeKey === 'whole_engagement')
    expect(scopeInGap?.applicability).toBe('indeterminate')
    expect(scopeInGap?.indeterminateReason).toBeTruthy()

    const afterResume = resolveEngagementAtDate({ engagementId: 'eng-1', effects: [founder, susp] }, '2026-03-20')
    expect(afterResume.scopes.find((s) => s.scopeKey === 'whole_engagement')?.applicability).toBe('applicable')
  })

  it('SUSPEND one_off — suspended le jour même, applicable sans ambiguïté le lendemain', () => {
    const susp = row({ id: 'susp-1', effect: 'suspend', temporality: 'one_off', startsOn: '2026-05-10' })
    const onDay = resolveEngagementAtDate({ engagementId: 'eng-1', effects: [founder, susp] }, '2026-05-10')
    expect(onDay.scopes.find((s) => s.scopeKey === 'whole_engagement')?.applicability).toBe('suspended')
    const nextDay = resolveEngagementAtDate({ engagementId: 'eng-1', effects: [founder, susp] }, '2026-05-11')
    expect(nextDay.scopes.find((s) => s.scopeKey === 'whole_engagement')?.applicability).toBe('applicable')
  })

  it('SUSPEND whole_engagement domine une portée plus étroite sans effacer sa valeur repliée', () => {
    const mod = row({
      id: 'mod-dom',
      effect: 'modify',
      scopeKey: 'lot_a',
      startsOn: '2026-01-01',
      effectPayload: { price: 50 },
    })
    const susp = row({
      id: 'susp-dom',
      effect: 'suspend',
      temporality: 'bounded',
      startsOn: '2026-06-01',
      endsOn: '2026-06-30',
    })
    const dto = resolveEngagementAtDate({ engagementId: 'eng-1', effects: [founder, mod, susp] }, '2026-06-15')
    const lotA = dto.scopes.find((s) => s.scopeKey === 'lot_a')
    expect(lotA).toMatchObject({
      applicability: 'suspended',
      dominatedByWholeEngagementSuspend: true,
      basis: 'modify',
      value: { price: 50 },
      sourceEffectId: 'mod-dom',
    })
    const whole = dto.scopes.find((s) => s.scopeKey === 'whole_engagement')
    expect(whole).toMatchObject({ applicability: 'suspended', dominatedByWholeEngagementSuspend: false })
  })

  it('SUSPEND whole_engagement indeterminate (event_driven) — propagé tel quel aux portées dominées', () => {
    const mod = row({
      id: 'mod-dom2',
      effect: 'modify',
      scopeKey: 'lot_a',
      startsOn: '2026-01-01',
      effectPayload: { price: 75 },
    })
    const susp = row({
      id: 'susp-dom-ev',
      effect: 'suspend',
      temporality: 'event_driven',
      startsOn: '2026-06-01',
    })
    const dto = resolveEngagementAtDate({ engagementId: 'eng-1', effects: [founder, mod, susp] }, '2026-06-15')
    const lotA = dto.scopes.find((s) => s.scopeKey === 'lot_a')
    expect(lotA).toMatchObject({
      applicability: 'indeterminate',
      dominatedByWholeEngagementSuspend: true,
      basis: 'modify',
      value: { price: 75 },
    })
    const whole = dto.scopes.find((s) => s.scopeKey === 'whole_engagement')
    expect(whole?.applicability).toBe('indeterminate')
  })

  it('SUSPEND scopé sans MODIFY correspondant — la portée apparaît malgré tout dans le DTO', () => {
    const susp = row({
      id: 'susp-scope-only',
      effect: 'suspend',
      scopeKey: 'lot_z',
      temporality: 'bounded',
      startsOn: '2026-02-01',
      endsOn: '2026-02-28',
    })
    const during = resolveEngagementAtDate({ engagementId: 'eng-1', effects: [founder, susp] }, '2026-02-15')
    const lotZDuring = during.scopes.find((s) => s.scopeKey === 'lot_z')
    expect(lotZDuring).toMatchObject({
      applicability: 'suspended',
      dominatedByWholeEngagementSuspend: false,
      basis: 'new',
      value: null,
    })

    const after = resolveEngagementAtDate({ engagementId: 'eng-1', effects: [founder, susp] }, '2026-03-01')
    const lotZAfter = after.scopes.find((s) => s.scopeKey === 'lot_z')
    expect(lotZAfter?.applicability).toBe('applicable')
  })
})

describe('resolveEngagementAtDate — CONFIRM (doctrine 8)', () => {
  it('CONFIRM n’affecte ni valeur ni existence ni applicabilité — pure provenance', () => {
    const founder = row({ id: 'new-1', effect: 'new', temporality: 'permanent', startsOn: '2026-01-01' })
    const confirm = row({
      id: 'conf-1',
      effect: 'confirm',
      startsOn: '2026-02-01',
      appliedAt: '2026-02-05T00:00:00Z',
    })
    const dto = resolveEngagementAtDate({ engagementId: 'eng-1', effects: [founder, confirm] }, '2026-06-01')
    expect(dto.existence.status).toBe('exists')
    const whole = dto.scopes.find((s) => s.scopeKey === 'whole_engagement')
    expect(whole).toMatchObject({ applicability: 'applicable', basis: 'new', value: null })

    const provenance = dto.provenanceTrail.find((p) => p.effectId === 'conf-1')
    expect(provenance).toMatchObject({
      startsOn: '2026-02-01',
      endsOn: null,
      resumeOn: null,
      recordedInMemoriaAt: '2026-02-05T00:00:00Z',
      recordedAfterQueriedDate: false,
      orphaned: false,
      usedInResolution: false,
    })
  })

  it('provenance — recordedAfterQueriedDate reflète un enregistrement postérieur à la date interrogée', () => {
    const founder = row({ id: 'new-1', effect: 'new', temporality: 'permanent', startsOn: '2026-01-01' })
    const confirm = row({
      id: 'conf-1',
      effect: 'confirm',
      startsOn: '2026-01-10',
      appliedAt: '2026-02-05T00:00:00Z',
    })
    const dto = resolveEngagementAtDate({ engagementId: 'eng-1', effects: [founder, confirm] }, '2026-01-15')
    const provenance = dto.provenanceTrail.find((p) => p.effectId === 'conf-1')
    expect(provenance?.recordedAfterQueriedDate).toBe(true)
  })

  it('provenance — startsOn/endsOn/resumeOn contractuels exposés, distincts de recordedInMemoriaAt', () => {
    const founder = row({ id: 'new-1', effect: 'new', temporality: 'permanent', startsOn: '2026-01-01' })
    const susp = row({
      id: 'susp-prov',
      effect: 'suspend',
      temporality: 'bounded',
      startsOn: '2026-02-01',
      endsOn: '2026-02-28',
      resumeOn: '2026-03-15',
      appliedAt: '2026-01-20T00:00:00Z',
    })
    const dto = resolveEngagementAtDate({ engagementId: 'eng-1', effects: [founder, susp] }, '2026-02-15')
    const provenance = dto.provenanceTrail.find((p) => p.effectId === 'susp-prov')
    expect(provenance).toMatchObject({
      startsOn: '2026-02-01',
      endsOn: '2026-02-28',
      resumeOn: '2026-03-15',
      recordedInMemoriaAt: '2026-01-20T00:00:00Z',
    })
  })
})

describe('resolveEngagementAtDate — effets orphelins (doctrine 2)', () => {
  it('un effet daté après l’expiration d’un NEW bounded est exclu et signalé, jamais résurrecteur', () => {
    const founder = row({
      id: 'new-bounded',
      effect: 'new',
      temporality: 'bounded',
      startsOn: '2026-02-01',
      endsOn: '2026-02-28',
    })
    const lateModify = row({
      id: 'mod-orphan',
      effect: 'modify',
      scopeKey: 'lot_a',
      startsOn: '2026-03-01',
      effectPayload: { price: 1 },
    })
    const dto = resolveEngagementAtDate({ engagementId: 'eng-1', effects: [founder, lateModify] }, '2026-04-01')
    expect(dto.existence).toEqual({
      status: 'expired',
      foundedBy: 'new-bounded',
      existsFrom: '2026-02-01',
      existsUntil: '2026-02-28',
    })
    expect(dto.scopes).toEqual([])
    expect(dto.anomalies).toEqual([
      {
        type: 'orphaned_effect',
        message:
          "Effet(s) daté(s) hors de la fenêtre d'existence fixée par NEW — exclus du calcul, l'existence n'est jamais ressuscitée.",
        effectIds: ['mod-orphan'],
      },
    ])
    const provenance = dto.provenanceTrail.find((p) => p.effectId === 'mod-orphan')
    expect(provenance).toMatchObject({ orphaned: true, usedInResolution: false })
  })
})

describe('resolveEngagementAtDate — déterminisme (indépendance à l’ordre du tableau)', () => {
  it('le même jeu d’effets dans un ordre différent produit un DTO strictement identique', () => {
    const founder = row({ id: 'new-1', effect: 'new', temporality: 'permanent', startsOn: '2026-01-01' })
    const mod1 = row({
      id: 'mod-1',
      effect: 'modify',
      scopeKey: 'lot_a',
      startsOn: '2026-01-01',
      effectPayload: { price: 100 },
    })
    const mod2 = row({
      id: 'mod-2',
      effect: 'modify',
      temporality: 'bounded',
      scopeKey: 'lot_a',
      startsOn: '2026-03-01',
      endsOn: '2026-03-31',
      effectPayload: { price: 200 },
    })
    const susp = row({
      id: 'susp-1',
      effect: 'suspend',
      temporality: 'bounded',
      scopeKey: 'whole_engagement',
      startsOn: '2026-06-01',
      endsOn: '2026-06-30',
    })
    const confirm = row({ id: 'conf-1', effect: 'confirm', startsOn: '2026-02-01' })

    const original = [founder, mod1, mod2, susp, confirm]
    const reversed = [...original].reverse()
    const shuffled = [susp, confirm, founder, mod2, mod1]

    const queriedDate = '2026-06-15'
    const dtoOriginal = resolveEngagementAtDate({ engagementId: 'eng-1', effects: original }, queriedDate)
    const dtoReversed = resolveEngagementAtDate({ engagementId: 'eng-1', effects: reversed }, queriedDate)
    const dtoShuffled = resolveEngagementAtDate({ engagementId: 'eng-1', effects: shuffled }, queriedDate)

    expect(dtoReversed).toEqual(dtoOriginal)
    expect(dtoShuffled).toEqual(dtoOriginal)
  })

  it('le même jeu d’effets en conflit (plusieurs NEW) reste identique quel que soit l’ordre', () => {
    const newA = row({ id: 'new-a', effect: 'new', temporality: 'permanent', startsOn: '2026-01-01' })
    const newB = row({ id: 'new-b', effect: 'new', temporality: 'permanent', startsOn: '2026-02-01' })
    const dtoA = resolveEngagementAtDate({ engagementId: 'eng-1', effects: [newA, newB] }, '2026-06-01')
    const dtoB = resolveEngagementAtDate({ engagementId: 'eng-1', effects: [newB, newA] }, '2026-06-01')
    expect(dtoB).toEqual(dtoA)
  })
})
