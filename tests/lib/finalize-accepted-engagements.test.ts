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

// DOC-CONTRACT-OS-1A — FIX de fermeture (mandat Vincent 2026-09-28). Le bypass
// concret signalé : qualifier une proposition CONFLICT, cliquer « Enregistrer la
// qualification » (review_status passe à 'edited'), puis « Finaliser les
// Engagements » créait quand même un Engagement. Une proposition qualifiée
// conflict/non_engagement/confirm/modify/suspend ne doit jamais être créée
// automatiquement ici ; l'absence de qualification (CCTP historique) doit
// continuer à créer normalement.
describe('finalizeAcceptedEngagementsForRun — garde EFFET × TEMPORALITÉ (DOC-CONTRACT-OS-1A)', () => {
  it('conflict — jamais créé, compté en needsReviewCount, aucun appel RPC', async () => {
    proposalsResult = {
      data: [{
        id: 'p1',
        source_payload: { kind: 'obligation', category: 'sla', measurable: true, contract_effect: { effect: 'conflict' } },
      }],
      error: null,
    }

    const result = await finalizeAcceptedEngagementsForRun({ runId: 'run-1', userId: 'user-1' })

    expect(result).toEqual({ ok: true, createdCount: 0, needsReviewCount: 1 })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('non_engagement — jamais créé, aucun appel RPC', async () => {
    proposalsResult = {
      data: [{
        id: 'p1',
        source_payload: { kind: 'obligation', category: 'sla', measurable: true, contract_effect: { effect: 'non_engagement' } },
      }],
      error: null,
    }

    const result = await finalizeAcceptedEngagementsForRun({ runId: 'run-1', userId: 'user-1' })

    expect(result).toEqual({ ok: true, createdCount: 0, needsReviewCount: 1 })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('confirm — jamais créé automatiquement (link_existing reste un geste humain par carte)', async () => {
    proposalsResult = {
      data: [{
        id: 'p1',
        source_payload: { kind: 'obligation', category: 'sla', measurable: true, contract_effect: { effect: 'confirm', targetEngagementId: 'eng-1' } },
      }],
      error: null,
    }

    const result = await finalizeAcceptedEngagementsForRun({ runId: 'run-1', userId: 'user-1' })

    expect(result).toEqual({ ok: true, createdCount: 0, needsReviewCount: 1 })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('modify/suspend — aucune matérialisation tant que DOC-CONTRACT-OS-1B n\'existe pas', async () => {
    proposalsResult = {
      data: [
        { id: 'p1', source_payload: { kind: 'obligation', category: 'sla', measurable: true, contract_effect: { effect: 'modify', targetEngagementId: 'eng-1' } } },
        { id: 'p2', source_payload: { kind: 'controle', category: 'quality', measurable: false, contract_effect: { effect: 'suspend', targetEngagementId: 'eng-1' } } },
      ],
      error: null,
    }

    const result = await finalizeAcceptedEngagementsForRun({ runId: 'run-1', userId: 'user-1' })

    expect(result).toEqual({ ok: true, createdCount: 0, needsReviewCount: 2 })
    expect(rpc).not.toHaveBeenCalled()
  })

  // Durci DOC-CONTRACT-OS-1B1-UX-BRIDGE (revue Vincent/ChatGPT 2026-09-29,
  // défaut 1) : un NEW qualifié sort lui aussi du chemin bulk/legacy — seule
  // materializeContractEffectAction (1B1), un geste humain explicite par
  // proposition, peut le matérialiser. Le bulk ne doit jamais y être routé
  // silencieusement : la proposition reste comptée en needsReviewCount.
  it('new qualifié — jamais créé par le bulk, compté en needsReviewCount, aucun appel RPC legacy', async () => {
    proposalsResult = {
      data: [{
        id: 'p1',
        source_payload: { kind: 'obligation', category: 'sla', measurable: true, contract_effect: { effect: 'new' } },
      }],
      error: null,
    }

    const result = await finalizeAcceptedEngagementsForRun({ runId: 'run-1', userId: 'user-1' })

    expect(result).toEqual({ ok: true, createdCount: 0, needsReviewCount: 1 })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('sans contract_effect (CCTP historique, jamais qualifié) — comportement historique conservé', async () => {
    proposalsResult = {
      data: [{ id: 'p1', source_payload: { kind: 'obligation', category: 'sla', measurable: true } }],
      error: null,
    }
    rpc.mockResolvedValue({ data: 'eng-x', error: null })

    const result = await finalizeAcceptedEngagementsForRun({ runId: 'run-1', userId: 'user-1' })

    expect(result).toEqual({ ok: true, createdCount: 1, needsReviewCount: 0 })
  })
})

// DOC-CONTRACT-OS-1A — DERNIER GATE (mandat de fermeture Vincent 2026-09-28).
// Le geste groupé « Finaliser les Engagements » doit exclure lui aussi un
// ordre_service/avenant sans qualification enregistrée, pas seulement le
// geste par carte — sinon il contourne la qualification requise.
describe('finalizeAcceptedEngagementsForRun — documentType (DOC-CONTRACT-OS-1A dernier gate)', () => {
  it('CCTP explicite sans contract_effect — bulk crée normalement', async () => {
    proposalsResult = {
      data: [{ id: 'p1', source_payload: { kind: 'obligation', category: 'sla', measurable: true } }],
      error: null,
    }
    rpc.mockResolvedValue({ data: 'eng-x', error: null })

    const result = await finalizeAcceptedEngagementsForRun({ runId: 'run-1', userId: 'user-1', documentType: 'cctp' })

    expect(result).toEqual({ ok: true, createdCount: 1, needsReviewCount: 0 })
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('ordre_service sans contract_effect — bulk ne crée rien, needsReviewCount, aucun appel RPC', async () => {
    proposalsResult = {
      data: [{ id: 'p1', source_payload: { kind: 'obligation', category: 'sla', measurable: true } }],
      error: null,
    }

    const result = await finalizeAcceptedEngagementsForRun({ runId: 'run-1', userId: 'user-1', documentType: 'ordre_service' })

    expect(result).toEqual({ ok: true, createdCount: 0, needsReviewCount: 1 })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('avenant sans contract_effect — bulk ne crée rien, needsReviewCount, aucun appel RPC', async () => {
    proposalsResult = {
      data: [{ id: 'p1', source_payload: { kind: 'obligation', category: 'sla', measurable: true } }],
      error: null,
    }

    const result = await finalizeAcceptedEngagementsForRun({ runId: 'run-1', userId: 'user-1', documentType: 'avenant' })

    expect(result).toEqual({ ok: true, createdCount: 0, needsReviewCount: 1 })
    expect(rpc).not.toHaveBeenCalled()
  })

  // Durci DOC-CONTRACT-OS-1B1-UX-BRIDGE (revue Vincent/ChatGPT 2026-09-29, défaut 1).
  it('ordre_service + effet NEW qualifié — bulk ne crée rien, needsReviewCount, aucun appel RPC legacy', async () => {
    proposalsResult = {
      data: [{
        id: 'p1',
        source_payload: { kind: 'obligation', category: 'sla', measurable: true, contract_effect: { effect: 'new' } },
      }],
      error: null,
    }

    const result = await finalizeAcceptedEngagementsForRun({ runId: 'run-1', userId: 'user-1', documentType: 'ordre_service' })

    expect(result).toEqual({ ok: true, createdCount: 0, needsReviewCount: 1 })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('documentType absent (comportement legacy par défaut) — équivalent à CCTP, bulk crée normalement', async () => {
    proposalsResult = {
      data: [{ id: 'p1', source_payload: { kind: 'obligation', category: 'sla', measurable: true } }],
      error: null,
    }
    rpc.mockResolvedValue({ data: 'eng-x', error: null })

    const result = await finalizeAcceptedEngagementsForRun({ runId: 'run-1', userId: 'user-1' })

    expect(result).toEqual({ ok: true, createdCount: 1, needsReviewCount: 0 })
  })
})
