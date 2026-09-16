// P0-B.1 / P0-B.2 (durcissement + sécurité temporelle, arbitrage Vincent
// 2026-09-17) — planification pure de la réconciliation post-CBO des Actions
// longitudinales.
//
// planActionCboReconciliation est une fonction pure (aucun I/O) : ces tests
// couvrent directement sa logique de sélection d'identité durable, d'échelle
// de statut (cas A/B/C/D/E de la revue P0-B.2) et de protection des données
// humaines explicites, sans mock Supabase. Le module applicatif
// (reconcileActionsByCanonicalBusinessObjectForReport) n'est pas testé ici —
// il ne fait qu'orchestrer lectures/écritures autour de cette fonction pure.
//
// P0-B.2 : la chronologie utilisée est `businessDate` (jamais `createdAt` ni
// l'ordre du tableau). Les tests de la section « cas A/B/C/D/E » fixent
// délibérément un `businessDate` indépendant de `createdAt` et rejouent
// chaque cas dans les deux ordres d'import, pour prouver l'invariance par
// permutation exigée par la revue.

import { describe, it, expect } from 'vitest'
import {
  planActionCboReconciliation,
  type ReconciliationCandidateAction,
} from '@/lib/db/action-cbo-reconciliation'

function action(
  overrides: Partial<ReconciliationCandidateAction> & { id: string },
): ReconciliationCandidateAction {
  const createdAt = overrides.createdAt ?? '2026-01-01T00:00:00Z'
  return {
    createdAt,
    businessDate: createdAt,
    status: 'open',
    supersededBy: null,
    title: null,
    body: null,
    assignedTo: null,
    assignedContactId: null,
    assignedCompanyId: null,
    dueDate: null,
    dueDateStatus: null,
    reserveId: null,
    doneAt: null,
    completedComment: null,
    completedPhotoPath: null,
    contactExplicitlyCleared: false,
    companyExplicitlyCleared: false,
    dueDateExplicitlyCleared: false,
    ...overrides,
  }
}

describe('planActionCboReconciliation — sélection de groupe', () => {
  it('ne fait rien pour un tableau vide', () => {
    expect(planActionCboReconciliation([])).toEqual({ kind: 'none' })
  })

  it('ne fait rien pour un seul candidat actif', () => {
    const actions = [action({ id: 'a1' })]
    expect(planActionCboReconciliation(actions)).toEqual({ kind: 'none' })
  })

  it('exclut une action déjà superseded des candidats', () => {
    const actions = [
      action({ id: 'a-open', businessDate: '2026-01-01T00:00:00Z' }),
      action({ id: 'a-superseded', businessDate: '2026-01-02T00:00:00Z', supersededBy: 'a-open', status: 'cancelled' }),
    ]
    expect(planActionCboReconciliation(actions)).toEqual({ kind: 'none' })
  })

  it("exclut une action 'cancelled' des candidats", () => {
    const actions = [
      action({ id: 'a-cancelled', businessDate: '2026-01-01T00:00:00Z', status: 'cancelled' }),
      action({ id: 'a-open', businessDate: '2026-01-02T00:00:00Z', status: 'open' }),
    ]
    expect(planActionCboReconciliation(actions)).toEqual({ kind: 'none' })
  })

  it('départage par id quand businessDate est identique (déterministe)', () => {
    const actions = [
      action({ id: 'b', businessDate: '2026-01-01T00:00:00Z' }),
      action({ id: 'a', businessDate: '2026-01-01T00:00:00Z' }),
    ]
    const plan = planActionCboReconciliation(actions)
    expect(plan.kind).toBe('merge')
    expect(plan).toMatchObject({ durableId: 'a', loserIds: ['b'] })
  })

  it("trie par businessDate, jamais par createdAt ni par l'ordre du tableau (import rétroactif)", () => {
    // Importée EN PREMIER (createdAt le plus ancien) mais business date plus
    // récente : ne doit jamais devenir la durable.
    const actions = [
      action({ id: 'imported-first-business-later', createdAt: '2026-01-01T00:00:00Z', businessDate: '2026-12-13T00:00:00Z' }),
      action({ id: 'imported-second-business-earlier', createdAt: '2026-06-01T00:00:00Z', businessDate: '2026-12-10T00:00:00Z' }),
    ]
    const plan = planActionCboReconciliation(actions)
    expect(plan.kind).toBe('merge')
    expect(plan).toMatchObject({ durableId: 'imported-second-business-earlier', loserIds: ['imported-first-business-later'] })
  })

  it('gère plus de deux candidats : une seule durable, toutes les autres fusionnées', () => {
    const actions = [
      action({ id: 'a3', businessDate: '2026-03-01T00:00:00Z' }),
      action({ id: 'a1', businessDate: '2026-01-01T00:00:00Z' }),
      action({ id: 'a2', businessDate: '2026-02-01T00:00:00Z' }),
    ]
    const plan = planActionCboReconciliation(actions)
    expect(plan.kind).toBe('merge')
    expect(plan).toMatchObject({ durableId: 'a1', loserIds: ['a2', 'a3'] })
  })
})

describe('planActionCboReconciliation — cas A/B/C/D/E (revue P0-B.2), invariants par permutation', () => {
  const EARLY = '2026-12-10T00:00:00Z' // PV du 10/12
  const LATE = '2026-12-13T00:00:00Z' // PV du 13/12

  it('cas A — 10/12 OPEN, 13/12 DONE → final DONE, quel que soit l’ordre d’import', () => {
    const early = action({ id: 'pv-10-12', businessDate: EARLY, status: 'open' })
    const late = action({
      id: 'pv-13-12',
      businessDate: LATE,
      status: 'done',
      doneAt: '2026-12-13T10:00:00Z',
      completedComment: 'Réserve levée',
    })

    for (const actions of [[early, late], [late, early]]) {
      const plan = planActionCboReconciliation(actions)
      expect(plan.kind).toBe('merge')
      if (plan.kind !== 'merge') throw new Error('unreachable')
      expect(plan.durableId).toBe('pv-10-12')
      expect(plan.loserIds).toEqual(['pv-13-12'])
      expect(plan.patch.status).toBe('done')
      expect(plan.patch.doneAt).toBe('2026-12-13T10:00:00Z')
      expect(plan.patch.completedComment).toBe('Réserve levée')
    }
  })

  it('cas B — 10/12 DONE, 13/12 OPEN → AUCUNE fusion (réouverture jamais silencieuse), quel que soit l’ordre d’import', () => {
    const early = action({ id: 'pv-10-12', businessDate: EARLY, status: 'done', doneAt: '2026-12-10T10:00:00Z' })
    const late = action({ id: 'pv-13-12', businessDate: LATE, status: 'open' })

    for (const actions of [[early, late], [late, early]]) {
      const plan = planActionCboReconciliation(actions)
      expect(plan).toEqual({
        kind: 'blocked_done_durable',
        reason: 'reopened_after_done',
        durableId: 'pv-10-12',
        pendingActiveIds: ['pv-13-12'],
      })
    }
  })

  it('cas C — 10/12 PLANNED, 13/12 OPEN → final OPEN, quel que soit l’ordre d’import', () => {
    const early = action({ id: 'pv-10-12', businessDate: EARLY, status: 'planned' })
    const late = action({ id: 'pv-13-12', businessDate: LATE, status: 'open' })

    for (const actions of [[early, late], [late, early]]) {
      const plan = planActionCboReconciliation(actions)
      expect(plan.kind).toBe('merge')
      if (plan.kind !== 'merge') throw new Error('unreachable')
      expect(plan.durableId).toBe('pv-10-12')
      expect(plan.patch.status).toBe('open')
    }
  })

  it('cas D — 10/12 OPEN, 13/12 OPEN → une seule Action active, quel que soit l’ordre d’import', () => {
    const early = action({ id: 'pv-10-12', businessDate: EARLY, status: 'open' })
    const late = action({ id: 'pv-13-12', businessDate: LATE, status: 'open' })

    for (const actions of [[early, late], [late, early]]) {
      const plan = planActionCboReconciliation(actions)
      expect(plan.kind).toBe('merge')
      if (plan.kind !== 'merge') throw new Error('unreachable')
      expect(plan.durableId).toBe('pv-10-12')
      expect(plan.loserIds).toEqual(['pv-13-12'])
      expect(plan.patch.status).toBeUndefined()
    }
  })

  it('cas E — 10/12 DONE, 13/12 DONE → jamais supposé doublon fusible sans preuve, signalé quel que soit l’ordre d’import', () => {
    const early = action({ id: 'pv-10-12', businessDate: EARLY, status: 'done' })
    const late = action({ id: 'pv-13-12', businessDate: LATE, status: 'done' })

    for (const actions of [[early, late], [late, early]]) {
      const plan = planActionCboReconciliation(actions)
      expect(plan).toEqual({
        kind: 'blocked_done_durable',
        reason: 'multiple_done_occurrences',
        durableId: 'pv-10-12',
        pendingActiveIds: ['pv-13-12'],
      })
    }
  })

  it("le statut ne recule jamais même si la durable n'est pas la plus avancée en apparence", () => {
    // Durable déjà 'done' (business date la plus ancienne) : même un doublon
    // 'planned' ou 'open' plus tardif ne modifie rien silencieusement.
    const actions = [
      action({ id: 'a-done', businessDate: '2026-01-01T00:00:00Z', status: 'done' }),
      action({ id: 'a-planned', businessDate: '2026-02-01T00:00:00Z', status: 'planned' }),
      action({ id: 'a-open', businessDate: '2026-03-01T00:00:00Z', status: 'open' }),
    ]
    const plan = planActionCboReconciliation(actions)
    expect(plan.kind).toBe('blocked_done_durable')
    if (plan.kind !== 'blocked_done_durable') throw new Error('unreachable')
    expect(plan.reason).toBe('reopened_after_done')
    expect(plan.durableId).toBe('a-done')
    expect(plan.pendingActiveIds.sort()).toEqual(['a-open', 'a-planned'])
  })
})

describe('planActionCboReconciliation — fusion de champs (jamais un écrasement silencieux)', () => {
  it('comble un champ simple vide côté durable depuis un doublon', () => {
    const actions = [
      action({ id: 'a-earlier', businessDate: '2026-01-01T00:00:00Z', title: null, body: null }),
      action({ id: 'a-later', businessDate: '2026-02-01T00:00:00Z', title: 'Titre précis', body: 'Détail du corps' }),
    ]
    const plan = planActionCboReconciliation(actions)
    expect(plan.kind).toBe('merge')
    if (plan.kind !== 'merge') throw new Error('unreachable')
    expect(plan.patch.title).toBe('Titre précis')
    expect(plan.patch.body).toBe('Détail du corps')
  })

  it('ne remplace JAMAIS un champ simple déjà renseigné côté durable', () => {
    const actions = [
      action({ id: 'a-earlier', businessDate: '2026-01-01T00:00:00Z', title: 'Titre durable' }),
      action({ id: 'a-later', businessDate: '2026-02-01T00:00:00Z', title: 'Autre titre' }),
    ]
    const plan = planActionCboReconciliation(actions)
    expect(plan.kind).toBe('merge')
    if (plan.kind !== 'merge') throw new Error('unreachable')
    expect(plan.patch.title).toBeUndefined()
  })

  it("exemple de la revue : PV1 sans responsable/échéance, PV2 fournit due_date + responsable — la durable absorbe les deux", () => {
    const actions = [
      action({ id: 'pv1', businessDate: '2026-01-01T00:00:00Z' }),
      action({
        id: 'pv2',
        businessDate: '2026-02-01T00:00:00Z',
        assignedContactId: 'contact-lylo',
        dueDate: '2026-03-01',
        dueDateStatus: 'explicit',
      }),
    ]
    const plan = planActionCboReconciliation(actions)
    expect(plan.kind).toBe('merge')
    if (plan.kind !== 'merge') throw new Error('unreachable')
    expect(plan.durableId).toBe('pv1')
    expect(plan.patch.assignedContactId).toBe('contact-lylo')
    expect(plan.patch.dueDate).toBe('2026-03-01')
    expect(plan.patch.dueDateStatus).toBe('explicit')
  })
})

describe('planActionCboReconciliation — protection des données humaines explicites', () => {
  it('ne remplit jamais le contact si un humain l’a explicitement retiré (unassigned)', () => {
    const actions = [
      action({
        id: 'a-earlier',
        businessDate: '2026-01-01T00:00:00Z',
        assignedContactId: null,
        contactExplicitlyCleared: true,
      }),
      action({ id: 'a-later', businessDate: '2026-02-01T00:00:00Z', assignedContactId: 'contact-x' }),
    ]
    const plan = planActionCboReconciliation(actions)
    expect(plan.kind).toBe('merge')
    if (plan.kind !== 'merge') throw new Error('unreachable')
    expect(plan.patch.assignedContactId).toBeUndefined()
  })

  it('ne remplit jamais l’entreprise si un humain l’a explicitement retirée (unassigned, mig 414)', () => {
    const actions = [
      action({
        id: 'a-earlier',
        businessDate: '2026-01-01T00:00:00Z',
        assignedCompanyId: null,
        companyExplicitlyCleared: true,
      }),
      action({ id: 'a-later', businessDate: '2026-02-01T00:00:00Z', assignedCompanyId: 'company-x' }),
    ]
    const plan = planActionCboReconciliation(actions)
    expect(plan.kind).toBe('merge')
    if (plan.kind !== 'merge') throw new Error('unreachable')
    expect(plan.patch.assignedCompanyId).toBeUndefined()
  })

  it('ne remplit jamais l’échéance si un humain l’a explicitement retirée (due_date_changed → null)', () => {
    const actions = [
      action({
        id: 'a-earlier',
        businessDate: '2026-01-01T00:00:00Z',
        dueDate: null,
        dueDateExplicitlyCleared: true,
      }),
      action({ id: 'a-later', businessDate: '2026-02-01T00:00:00Z', dueDate: '2026-05-01', dueDateStatus: 'estimated' }),
    ]
    const plan = planActionCboReconciliation(actions)
    expect(plan.kind).toBe('merge')
    if (plan.kind !== 'merge') throw new Error('unreachable')
    expect(plan.patch.dueDate).toBeUndefined()
    expect(plan.patch.dueDateStatus).toBeUndefined()
  })

  it('un contact déjà présent côté durable ne peut jamais être écrasé par un doublon', () => {
    const actions = [
      action({ id: 'a-earlier', businessDate: '2026-01-01T00:00:00Z', assignedContactId: 'contact-humain' }),
      action({ id: 'a-later', businessDate: '2026-02-01T00:00:00Z', assignedContactId: 'contact-import' }),
    ]
    const plan = planActionCboReconciliation(actions)
    expect(plan.kind).toBe('merge')
    if (plan.kind !== 'merge') throw new Error('unreachable')
    expect(plan.patch.assignedContactId).toBeUndefined()
  })
})

describe('planActionCboReconciliation — idempotence', () => {
  it('un groupe déjà entièrement réconcilié (perdants cancelled) ne produit aucun plan', () => {
    const actions = [
      action({ id: 'a-durable', businessDate: '2026-01-01T00:00:00Z', status: 'open' }),
      action({
        id: 'a-loser',
        businessDate: '2026-02-01T00:00:00Z',
        status: 'cancelled',
        supersededBy: 'a-durable',
      }),
    ]
    expect(planActionCboReconciliation(actions)).toEqual({ kind: 'none' })
  })
})
