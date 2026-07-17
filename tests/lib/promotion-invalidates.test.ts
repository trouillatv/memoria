import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── CONFIRMER DOIT RAFRAÎCHIR TOUS LES ÉCRANS ────────────────────────────────
// « Écarter » invalidait la projection depuis toujours. « Projeter » aussi.
// « Confirmer » — la mutation la plus importante du produit — n'invalidait rien.
//
// Le trou était étroit et donc invisible : `createSiteAction`, `createSiteDeadline`,
// `createKnowledgeEntry` et `createWatchpoint` invalident EUX-MÊMES, si bien que
// promouvoir une action marchait. Mais `createSiteDecision` et `openSiteIntervenant`
// n'invalidaient pas : promouvoir une DÉCISION ou un INTERVENANT ne rafraîchissait
// aucun écran (TTL 30 s de `getSiteProjection`).
//
// Et même pour les types qui marchaient, l'invalidation partait TROP TÔT : le
// créateur invalide avant que la proposition passe à 'confirmed'. Une recomposition
// déclenchée à cet instant recompte le fait comme « à confirmer ».
//
// Ce test vérifie le COMPORTEMENT (qui est appelé, avec quel chantier, dans quel
// ordre), pas la présence d'une ligne de code.

vi.mock('server-only', () => ({}))

const calls: string[] = []

const invalidateSiteProjection = vi.fn((siteId: string) => {
  calls.push(`invalidate:${siteId}`)
})
vi.mock('@/lib/knowledge/invalidate', () => ({
  invalidateSiteProjection: (siteId: string) => invalidateSiteProjection(siteId),
  siteProjectionTag: (siteId: string) => `site-projection:${siteId}`,
}))

// Les créateurs sont mockés : ce test porte sur la PROMOTION, pas sur l'écriture
// de l'objet (chaque créateur a ses propres garanties).
vi.mock('@/lib/db/site-actions', () => ({
  createSiteAction: vi.fn(async () => { calls.push('create:action'); return 'action-1' }),
}))
vi.mock('@/lib/db/site-deadlines', () => ({
  createSiteDeadline: vi.fn(async () => { calls.push('create:deadline'); return 'deadline-1' }),
}))
vi.mock('@/lib/db/site-decisions', () => ({
  createSiteDecision: vi.fn(async () => { calls.push('create:decision'); return 'decision-1' }),
}))
vi.mock('@/lib/db/site-intervenants', () => ({
  openSiteIntervenant: vi.fn(async () => { calls.push('create:intervenant') }),
}))
vi.mock('@/lib/db/companies', () => ({
  findOrCreateCompanyByName: vi.fn(async () => 'company-1'),
}))
vi.mock('@/lib/db/site-memory-entries', () => ({
  createKnowledgeEntry: vi.fn(async () => { calls.push('create:knowledge'); return 'entry-1' }),
  createWatchpoint: vi.fn(async () => { calls.push('create:watchpoint'); return 'wp-1' }),
  isChoosableKnowledgeKind: (k: string) => k === 'current_information' || k === 'durable_knowledge',
}))

const SITE = 'site-42'
let proposal: Record<string, unknown> | null = null

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: proposal, error: proposal ? null : { message: 'not found' } }),
        }),
      }),
      // La mise à jour du statut : c'est ELLE qui doit précéder l'invalidation.
      update: (patch: Record<string, unknown>) => ({
        eq: async () => {
          if (table === 'site_knowledge_proposals' && patch.status === 'confirmed') {
            calls.push('status:confirmed')
          }
          return { error: null }
        },
      }),
    }),
  }),
}))

import { promoteProposal } from '@/lib/db/knowledge-proposals'

function aProposal(kind: string): Record<string, unknown> {
  return {
    id: 'prop-1', organization_id: 'org-1', site_id: SITE, report_id: 'report-1',
    analysis_version: 1, kind, status: 'proposed',
    title: 'Un fait du chantier', body: null, payload: {}, confidence: null,
    source_capture_ids: [], dedupe_key: 'k', promoted_object_type: null,
    promoted_object_id: null, superseded_by: null, dismiss_reason: null,
    reviewed_at: null, reviewed_by: null,
    created_at: '2026-07-17T00:00:00.000Z', updated_at: '2026-07-17T00:00:00.000Z',
  }
}

beforeEach(() => {
  calls.length = 0
  invalidateSiteProjection.mockClear()
})

describe('Promouvoir une proposition rafraîchit le chantier', () => {
  it.each([
    ['action', { }],
    ['deadline', { }],
    ['decision', { }],
    // Les deux qui n'invalidaient rien du tout.
    ['stakeholder', { role: 'ETV' }],
    ['knowledge', { knowledgeKind: 'durable_knowledge' as const }],
    ['vigilance', { }],
  ])('« %s » promu invalide le chantier', async (kind, input) => {
    proposal = aProposal(kind)
    const res = await promoteProposal({ id: 'prop-1', userId: 'u-1', organizationId: 'org-1', input })

    expect(res.status).toBe('promoted')
    expect(invalidateSiteProjection).toHaveBeenCalledWith(SITE)
  })

  it('invalide APRÈS que la proposition a quitté « à confirmer »', async () => {
    // L'ordre est le cœur du sujet. Si l'invalidation part avant l'écriture du
    // statut, l'écran recomposé recompte le fait comme « à confirmer » — il
    // disparaîtrait de « validé » tout en restant « proposé ».
    proposal = aProposal('decision')
    await promoteProposal({ id: 'prop-1', userId: 'u-1', organizationId: 'org-1' })

    const statusAt = calls.indexOf('status:confirmed')
    const invalidateAt = calls.lastIndexOf(`invalidate:${SITE}`)
    expect(statusAt, 'le statut doit avoir été écrit').toBeGreaterThanOrEqual(0)
    expect(invalidateAt, 'l’invalidation doit avoir eu lieu').toBeGreaterThanOrEqual(0)
    expect(invalidateAt, 'l’invalidation doit SUIVRE l’écriture du statut').toBeGreaterThan(statusAt)
  })

  it('n’invalide RIEN quand rien n’a été écrit', async () => {
    // `needs_input` n'est pas une panne : c'est un refus d'inventer le rôle. Rien
    // n'a bougé — invalider ferait recomposer tous les écrans pour rien.
    proposal = aProposal('stakeholder')
    const res = await promoteProposal({ id: 'prop-1', userId: 'u-1', organizationId: 'org-1' })

    expect(res.status).toBe('needs_input')
    expect(invalidateSiteProjection).not.toHaveBeenCalled()
  })

  it('n’invalide rien pour une proposition d’une AUTRE organisation', async () => {
    // Garde fail-closed : le service-role bypasse la RLS.
    proposal = aProposal('decision')
    const res = await promoteProposal({ id: 'prop-1', userId: 'u-1', organizationId: 'org-AUTRE' })

    expect(res.status).toBe('not_found')
    expect(invalidateSiteProjection).not.toHaveBeenCalled()
  })
})
