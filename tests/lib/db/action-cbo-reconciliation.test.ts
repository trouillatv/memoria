// P0-B.1 (durcissement, arbitrage Vincent 2026-09-17) — planification pure de
// la réconciliation post-CBO des Actions longitudinales.
//
// planActionCboReconciliation est une fonction pure (aucun I/O) : ces tests
// couvrent directement sa logique de sélection d'identité durable, d'échelle
// de statut (cas A/B/C/D de la revue) et de protection des données humaines
// explicites, sans mock Supabase. Le module applicatif
// (reconcileActionsByCanonicalBusinessObjectForReport) n'est pas testé ici —
// il ne fait qu'orchestrer lectures/écritures autour de cette fonction pure.

import { describe, it, expect } from 'vitest'
import {
  planActionCboReconciliation,
  type ReconciliationCandidateAction,
} from '@/lib/db/action-cbo-reconciliation'

function action(
  overrides: Partial<ReconciliationCandidateAction> & { id: string },
): ReconciliationCandidateAction {
  return {
    createdAt: '2026-01-01T00:00:00Z',
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
      action({ id: 'a-open', createdAt: '2026-01-01T00:00:00Z' }),
      action({ id: 'a-superseded', createdAt: '2026-01-02T00:00:00Z', supersededBy: 'a-open', status: 'cancelled' }),
    ]
    expect(planActionCboReconciliation(actions)).toEqual({ kind: 'none' })
  })

  it("exclut une action 'cancelled' des candidats", () => {
    const actions = [
      action({ id: 'a-cancelled', createdAt: '2026-01-01T00:00:00Z', status: 'cancelled' }),
      action({ id: 'a-open', createdAt: '2026-01-02T00:00:00Z', status: 'open' }),
    ]
    expect(planActionCboReconciliation(actions)).toEqual({ kind: 'none' })
  })

  it('départage par id quand createdAt est identique (déterministe)', () => {
    const actions = [
      action({ id: 'b', createdAt: '2026-01-01T00:00:00Z' }),
      action({ id: 'a', createdAt: '2026-01-01T00:00:00Z' }),
    ]
    const plan = planActionCboReconciliation(actions)
    expect(plan.kind).toBe('merge')
    expect(plan).toMatchObject({ durableId: 'a', loserIds: ['b'] })
  })

  it('gère plus de deux candidats : une seule durable, toutes les autres fusionnées', () => {
    const actions = [
      action({ id: 'a3', createdAt: '2026-03-01T00:00:00Z' }),
      action({ id: 'a1', createdAt: '2026-01-01T00:00:00Z' }),
      action({ id: 'a2', createdAt: '2026-02-01T00:00:00Z' }),
    ]
    const plan = planActionCboReconciliation(actions)
    expect(plan.kind).toBe('merge')
    expect(plan).toMatchObject({ durableId: 'a1', loserIds: ['a2', 'a3'] })
  })
})

describe('planActionCboReconciliation — transitions de statut (cas A/B/C/D de la revue)', () => {
  it('cas A — OPEN → OPEN : fusion, statut inchangé, pas de patch status', () => {
    const actions = [
      action({ id: 'a-earlier', createdAt: '2026-01-01T00:00:00Z', status: 'open' }),
      action({ id: 'a-later', createdAt: '2026-02-01T00:00:00Z', status: 'open' }),
    ]
    const plan = planActionCboReconciliation(actions)
    expect(plan.kind).toBe('merge')
    if (plan.kind !== 'merge') throw new Error('unreachable')
    expect(plan.durableId).toBe('a-earlier')
    expect(plan.loserIds).toEqual(['a-later'])
    expect(plan.patch.status).toBeUndefined()
  })

  it('cas D — PLANNED → OPEN : la durable adopte open', () => {
    const actions = [
      action({ id: 'a-earlier', createdAt: '2026-01-01T00:00:00Z', status: 'planned' }),
      action({ id: 'a-later', createdAt: '2026-02-01T00:00:00Z', status: 'open' }),
    ]
    const plan = planActionCboReconciliation(actions)
    expect(plan.kind).toBe('merge')
    if (plan.kind !== 'merge') throw new Error('unreachable')
    expect(plan.patch.status).toBe('open')
  })

  it('cas B — OPEN → DONE : la durable adopte done et absorbe done_at/commentaire/photo', () => {
    const actions = [
      action({ id: 'a-earlier', createdAt: '2026-01-01T00:00:00Z', status: 'open' }),
      action({
        id: 'a-later',
        createdAt: '2026-02-01T00:00:00Z',
        status: 'done',
        doneAt: '2026-02-01T10:00:00Z',
        completedComment: 'Réserve levée',
        completedPhotoPath: '/photos/x.jpg',
      }),
    ]
    const plan = planActionCboReconciliation(actions)
    expect(plan.kind).toBe('merge')
    if (plan.kind !== 'merge') throw new Error('unreachable')
    expect(plan.durableId).toBe('a-earlier')
    expect(plan.loserIds).toEqual(['a-later'])
    expect(plan.patch.status).toBe('done')
    expect(plan.patch.doneAt).toBe('2026-02-01T10:00:00Z')
    expect(plan.patch.completedComment).toBe('Réserve levée')
    expect(plan.patch.completedPhotoPath).toBe('/photos/x.jpg')
  })

  it("cas C — DONE → OPEN plus tard : AUCUNE fusion, la clôture n'est jamais rouverte automatiquement", () => {
    const actions = [
      action({ id: 'a-earlier-done', createdAt: '2026-01-01T00:00:00Z', status: 'done', doneAt: '2026-01-01T10:00:00Z' }),
      action({ id: 'a-later-open', createdAt: '2026-02-01T00:00:00Z', status: 'open' }),
    ]
    const plan = planActionCboReconciliation(actions)
    expect(plan).toEqual({
      kind: 'blocked_done_durable',
      durableId: 'a-earlier-done',
      pendingActiveIds: ['a-later-open'],
    })
  })

  it("cas C — le statut ne recule jamais même si la durable n'est pas la plus avancée en apparence", () => {
    // Durable déjà 'done' : même un doublon 'planned' ou 'open' ne modifie rien.
    const actions = [
      action({ id: 'a-done', createdAt: '2026-01-01T00:00:00Z', status: 'done' }),
      action({ id: 'a-planned', createdAt: '2026-02-01T00:00:00Z', status: 'planned' }),
      action({ id: 'a-open', createdAt: '2026-03-01T00:00:00Z', status: 'open' }),
    ]
    const plan = planActionCboReconciliation(actions)
    expect(plan.kind).toBe('blocked_done_durable')
    if (plan.kind !== 'blocked_done_durable') throw new Error('unreachable')
    expect(plan.durableId).toBe('a-done')
    expect(plan.pendingActiveIds.sort()).toEqual(['a-open', 'a-planned'])
  })
})

describe('planActionCboReconciliation — fusion de champs (jamais un écrasement silencieux)', () => {
  it('comble un champ simple vide côté durable depuis un doublon', () => {
    const actions = [
      action({ id: 'a-earlier', createdAt: '2026-01-01T00:00:00Z', title: null, body: null }),
      action({ id: 'a-later', createdAt: '2026-02-01T00:00:00Z', title: 'Titre précis', body: 'Détail du corps' }),
    ]
    const plan = planActionCboReconciliation(actions)
    expect(plan.kind).toBe('merge')
    if (plan.kind !== 'merge') throw new Error('unreachable')
    expect(plan.patch.title).toBe('Titre précis')
    expect(plan.patch.body).toBe('Détail du corps')
  })

  it('ne remplace JAMAIS un champ simple déjà renseigné côté durable', () => {
    const actions = [
      action({ id: 'a-earlier', createdAt: '2026-01-01T00:00:00Z', title: 'Titre durable' }),
      action({ id: 'a-later', createdAt: '2026-02-01T00:00:00Z', title: 'Autre titre' }),
    ]
    const plan = planActionCboReconciliation(actions)
    expect(plan.kind).toBe('merge')
    if (plan.kind !== 'merge') throw new Error('unreachable')
    expect(plan.patch.title).toBeUndefined()
  })

  it("exemple de la revue : PV1 sans responsable/échéance, PV2 fournit due_date + responsable — la durable absorbe les deux", () => {
    const actions = [
      action({ id: 'pv1', createdAt: '2026-01-01T00:00:00Z' }),
      action({
        id: 'pv2',
        createdAt: '2026-02-01T00:00:00Z',
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
        createdAt: '2026-01-01T00:00:00Z',
        assignedContactId: null,
        contactExplicitlyCleared: true,
      }),
      action({ id: 'a-later', createdAt: '2026-02-01T00:00:00Z', assignedContactId: 'contact-x' }),
    ]
    const plan = planActionCboReconciliation(actions)
    expect(plan.kind).toBe('merge')
    if (plan.kind !== 'merge') throw new Error('unreachable')
    expect(plan.patch.assignedContactId).toBeUndefined()
  })

  it('ne remplit jamais l’échéance si un humain l’a explicitement retirée (due_date_changed → null)', () => {
    const actions = [
      action({
        id: 'a-earlier',
        createdAt: '2026-01-01T00:00:00Z',
        dueDate: null,
        dueDateExplicitlyCleared: true,
      }),
      action({ id: 'a-later', createdAt: '2026-02-01T00:00:00Z', dueDate: '2026-05-01', dueDateStatus: 'estimated' }),
    ]
    const plan = planActionCboReconciliation(actions)
    expect(plan.kind).toBe('merge')
    if (plan.kind !== 'merge') throw new Error('unreachable')
    expect(plan.patch.dueDate).toBeUndefined()
    expect(plan.patch.dueDateStatus).toBeUndefined()
  })

  it('un contact déjà présent côté durable ne peut jamais être écrasé par un doublon', () => {
    const actions = [
      action({ id: 'a-earlier', createdAt: '2026-01-01T00:00:00Z', assignedContactId: 'contact-humain' }),
      action({ id: 'a-later', createdAt: '2026-02-01T00:00:00Z', assignedContactId: 'contact-import' }),
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
      action({ id: 'a-durable', createdAt: '2026-01-01T00:00:00Z', status: 'open' }),
      action({
        id: 'a-loser',
        createdAt: '2026-02-01T00:00:00Z',
        status: 'cancelled',
        supersededBy: 'a-durable',
      }),
    ]
    expect(planActionCboReconciliation(actions)).toEqual({ kind: 'none' })
  })
})
