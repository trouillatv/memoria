// P0-2C FIX_REQUIRED (mandat Vincent 2026-09-24, revue SHA e88034a1) — problème 3.
//
// materialize_engagement_link_existing (RPC, migration 436) retourne l'ID de
// la ligne document_proposal_materialization, jamais l'ID de l'Engagement
// (cf. le SQL : `RETURN v_mat_id`/`v_existing_mat_id`). materializeEngagement
// LinkExisting ne doit donc jamais transmettre tel quel ce que la RPC
// retourne comme engagementId : l'Engagement cible est déjà connu de
// l'appelant (paramètre d'entrée) et c'est cette valeur qui doit être
// retournée.
//
// Test pur (aucune vraie Supabase) : seule la valeur de retour de la RPC est
// mockée, pour isoler ce contrat de tout aléa réseau/DB.

import { describe, it, expect, vi } from 'vitest'

const rpc = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ rpc }),
}))

import { materializeEngagementLinkExisting, materializeEngagementCreateNew } from '@/lib/db/materialize-engagement'

describe('materializeEngagementLinkExisting — contrat de retour (problème 3)', () => {
  it('retourne l’ID de l’Engagement cible passé en paramètre, jamais l’ID de matérialisation renvoyé par la RPC', async () => {
    rpc.mockResolvedValue({ data: 'mat-123', error: null })

    const result = await materializeEngagementLinkExisting('prop-1', 'eng-existing-1', 'user-1')

    expect(result).toBe('eng-existing-1')
    expect(rpc).toHaveBeenCalledWith('materialize_engagement_link_existing', {
      p_proposal_id: 'prop-1',
      p_engagement_id: 'eng-existing-1',
      p_user_id: 'user-1',
    })
  })

  it('propage l’erreur RPC sans retourner d’ID', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'cross-site refusé' } })

    await expect(materializeEngagementLinkExisting('prop-1', 'eng-2', 'user-1')).rejects.toThrow('cross-site refusé')
  })
})

describe('materializeEngagementCreateNew — transmet category/kind/measurable tels quels (problème 2)', () => {
  it('transmet exactement les valeurs humaines à la RPC, sans repli sur un défaut', async () => {
    rpc.mockResolvedValue({ data: 'eng-new-1', error: null })

    const result = await materializeEngagementCreateNew('prop-1', 'user-1', 'sla', 'obligation', false)

    expect(result).toBe('eng-new-1')
    expect(rpc).toHaveBeenCalledWith('materialize_engagement_create_new', {
      p_proposal_id: 'prop-1',
      p_user_id: 'user-1',
      p_category: 'sla',
      p_kind: 'obligation',
      p_measurable: false,
    })
  })
})
