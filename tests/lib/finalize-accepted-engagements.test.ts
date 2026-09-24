// Mandat Vincent 2026-09-25 (recette OCEF), correction #2 — combler le trou
// entre « proposition acceptée » et « Engagement matérialisé ». Ce test isole
// finalizeAcceptedEngagementsForRun (lib/db/materialize-engagement.ts) de tout
// aléa réseau/DB, comme tests/lib/materialize-engagement-wrapper.test.ts pour
// les fonctions RPC pures.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
let proposalsResult: { data: unknown[] | null; error: { message: string } | null }

function makeSelectChain() {
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(proposalsResult).then(resolve, reject),
  }
  return chain
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => makeSelectChain(),
    rpc,
  }),
}))

import { finalizeAcceptedEngagementsForRun } from '@/lib/db/materialize-engagement'

beforeEach(() => {
  rpc.mockReset()
})

describe('finalizeAcceptedEngagementsForRun', () => {
  it('crée un Engagement par proposition acceptée/edited avec nature IA valide', async () => {
    proposalsResult = {
      data: [
        { id: 'p1', source_payload: { kind: 'obligation', category: 'sla', measurable: true } },
        { id: 'p2', source_payload: { kind: 'controle', category: 'quality', measurable: false } },
      ],
      error: null,
    }
    rpc.mockResolvedValue({ data: 'eng-x', error: null })

    const result = await finalizeAcceptedEngagementsForRun({ runId: 'run-1', userId: 'user-1' })

    expect(result).toEqual({ ok: true, createdCount: 2, needsReviewCount: 0 })
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc).toHaveBeenCalledWith('materialize_engagement_create_new', {
      p_proposal_id: 'p1',
      p_user_id: 'user-1',
      p_category: 'sla',
      p_kind: 'obligation',
      p_measurable: true,
    })
  })

  it('category manquante ou invalide retombe sur "other", jamais un défaut inventé pour kind', async () => {
    proposalsResult = {
      data: [{ id: 'p1', source_payload: { kind: 'obligation', measurable: true } }],
      error: null,
    }
    rpc.mockResolvedValue({ data: 'eng-x', error: null })

    await finalizeAcceptedEngagementsForRun({ runId: 'run-1', userId: 'user-1' })

    expect(rpc).toHaveBeenCalledWith('materialize_engagement_create_new', expect.objectContaining({ p_category: 'other' }))
  })

  it('exclut sans matérialiser une proposition sans nature IA valide (needsReviewCount, aucun appel RPC)', async () => {
    proposalsResult = {
      data: [{ id: 'p1', source_payload: { category: 'sla', measurable: true } }],
      error: null,
    }

    const result = await finalizeAcceptedEngagementsForRun({ runId: 'run-1', userId: 'user-1' })

    expect(result).toEqual({ ok: true, createdCount: 0, needsReviewCount: 1 })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('compte needsReviewCount si la RPC échoue pour une proposition, sans bloquer les autres', async () => {
    proposalsResult = {
      data: [
        { id: 'p1', source_payload: { kind: 'obligation', category: 'sla', measurable: true } },
        { id: 'p2', source_payload: { kind: 'controle', category: 'quality', measurable: false } },
      ],
      error: null,
    }
    rpc
      .mockResolvedValueOnce({ data: null, error: { message: 'échec RPC' } })
      .mockResolvedValueOnce({ data: 'eng-x', error: null })

    const result = await finalizeAcceptedEngagementsForRun({ runId: 'run-1', userId: 'user-1' })

    expect(result).toEqual({ ok: true, createdCount: 1, needsReviewCount: 1 })
  })

  it("propage l'erreur de la requête initiale sans tenter aucune matérialisation", async () => {
    proposalsResult = { data: null, error: { message: 'db down' } }

    const result = await finalizeAcceptedEngagementsForRun({ runId: 'run-1', userId: 'user-1' })

    expect(result).toEqual({ ok: false, createdCount: 0, needsReviewCount: 0, error: 'db down' })
    expect(rpc).not.toHaveBeenCalled()
  })
})
