// P0-B (stabilisation post-2-PV, arbitrage Vincent 2026-09-17) — sélection du
// gagnant/perdants lors de la réconciliation post-CBO des Actions longitudinales.
//
// selectActionReconciliationPlan est une fonction pure (aucun I/O) : ces tests
// couvrent directement sa logique de sélection, sans mock Supabase. Le module
// applicatif (reconcileActionsByCanonicalBusinessObjectForReport) n'est pas
// testé ici — il ne fait qu'orchestrer des lectures/écritures autour de cette
// fonction pure, best-effort par construction (cf. commentaires du fichier).

import { describe, it, expect } from 'vitest'
import {
  selectActionReconciliationPlan,
  type ReconciliationCandidateAction,
} from '@/lib/db/action-cbo-reconciliation'

function action(overrides: Partial<ReconciliationCandidateAction> & { id: string }): ReconciliationCandidateAction {
  return {
    createdAt: '2026-01-01T00:00:00Z',
    status: 'open',
    supersededBy: null,
    ...overrides,
  }
}

describe('selectActionReconciliationPlan', () => {
  it('retourne null pour un tableau vide', () => {
    expect(selectActionReconciliationPlan([])).toBeNull()
  })

  it('retourne null pour un seul candidat actif', () => {
    const actions = [action({ id: 'a1', createdAt: '2026-01-01T00:00:00Z' })]
    expect(selectActionReconciliationPlan(actions)).toBeNull()
  })

  it("désigne la plus ancienne comme gagnante et l'autre comme perdante", () => {
    const actions = [
      action({ id: 'a-later', createdAt: '2026-02-01T00:00:00Z' }),
      action({ id: 'a-earlier', createdAt: '2026-01-01T00:00:00Z' }),
    ]
    const plan = selectActionReconciliationPlan(actions)
    expect(plan).toEqual({ winnerId: 'a-earlier', loserIds: ['a-later'] })
  })

  it('exclut une action déjà superseded des candidats', () => {
    const actions = [
      action({ id: 'a-open', createdAt: '2026-01-01T00:00:00Z' }),
      action({ id: 'a-superseded', createdAt: '2026-01-02T00:00:00Z', supersededBy: 'a-open' }),
    ]
    expect(selectActionReconciliationPlan(actions)).toBeNull()
  })

  it("exclut une action 'done' des candidats (jamais gagnante ni perdante)", () => {
    const actions = [
      action({ id: 'a-done', createdAt: '2026-01-01T00:00:00Z', status: 'done' }),
      action({ id: 'a-open', createdAt: '2026-01-02T00:00:00Z', status: 'open' }),
    ]
    expect(selectActionReconciliationPlan(actions)).toBeNull()
  })

  it("exclut une action 'cancelled' des candidats", () => {
    const actions = [
      action({ id: 'a-cancelled', createdAt: '2026-01-01T00:00:00Z', status: 'cancelled' }),
      action({ id: 'a-open', createdAt: '2026-01-02T00:00:00Z', status: 'open' }),
    ]
    expect(selectActionReconciliationPlan(actions)).toBeNull()
  })

  it('départage par id quand createdAt est identique (déterministe)', () => {
    const actions = [
      action({ id: 'b', createdAt: '2026-01-01T00:00:00Z' }),
      action({ id: 'a', createdAt: '2026-01-01T00:00:00Z' }),
    ]
    const plan = selectActionReconciliationPlan(actions)
    expect(plan).toEqual({ winnerId: 'a', loserIds: ['b'] })
  })

  it('gère plus de deux candidats : une seule gagnante, toutes les autres perdantes', () => {
    const actions = [
      action({ id: 'a3', createdAt: '2026-03-01T00:00:00Z' }),
      action({ id: 'a1', createdAt: '2026-01-01T00:00:00Z' }),
      action({ id: 'a2', createdAt: '2026-02-01T00:00:00Z' }),
    ]
    const plan = selectActionReconciliationPlan(actions)
    expect(plan).toEqual({ winnerId: 'a1', loserIds: ['a2', 'a3'] })
  })

  it("mélange 'planned' et 'open' comme candidats concurrents valides", () => {
    const actions = [
      action({ id: 'a-planned', createdAt: '2026-01-01T00:00:00Z', status: 'planned' }),
      action({ id: 'a-open', createdAt: '2026-01-02T00:00:00Z', status: 'open' }),
    ]
    const plan = selectActionReconciliationPlan(actions)
    expect(plan).toEqual({ winnerId: 'a-planned', loserIds: ['a-open'] })
  })
})
