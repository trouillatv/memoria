import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── « MODIFIER PUIS CONFIRMER » NE DOIT JAMAIS FUSIONNER (P0-1) ─────────────
// Le geste ajouté à l'action confirmée depuis la page Actions permet de
// corriger le titre/corps AVANT de créer l'objet. La proposition d'origine
// (site_knowledge_proposals.title/body) ne doit JAMAIS être mutée — seul
// l'objet créé (site_actions) porte la correction. Sans override, le texte
// de la proposition passe tel quel.

vi.mock('server-only', () => ({}))
vi.mock('@/lib/knowledge/invalidate', () => ({
  invalidateSiteProjection: vi.fn(),
  siteProjectionTag: (siteId: string) => `site-projection:${siteId}`,
}))

const createSiteAction = vi.fn(async (input: unknown) => { void input; return 'action-1' })
vi.mock('@/lib/db/site-actions', () => ({
  createSiteAction: (input: unknown) => createSiteAction(input),
}))

const SITE = 'site-42'
let proposal: Record<string, unknown> | null = null

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: proposal, error: proposal ? null : { message: 'not found' } }),
        }),
      }),
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  }),
}))

import { promoteProposal } from '@/lib/db/knowledge-proposals'

function anActionProposal(): Record<string, unknown> {
  return {
    id: 'prop-1', organization_id: 'org-1', site_id: SITE, report_id: 'report-1',
    analysis_version: 1, kind: 'action', status: 'proposed',
    title: 'Titre proposé par MemorIA', body: 'Corps proposé', payload: {}, confidence: null,
    source_capture_ids: [], dedupe_key: 'k', promoted_object_type: null,
    promoted_object_id: null, superseded_by: null, dismiss_reason: null,
    reviewed_at: null, reviewed_by: null,
    created_at: '2026-08-30T00:00:00.000Z', updated_at: '2026-08-30T00:00:00.000Z',
  }
}

beforeEach(() => {
  createSiteAction.mockClear()
})

describe('promoteProposal — titleOverride/bodyOverride (P0-1)', () => {
  it('sans override, le titre et le corps de la proposition passent tels quels', async () => {
    proposal = anActionProposal()
    await promoteProposal({ id: 'prop-1', userId: 'u-1', organizationId: 'org-1' })

    expect(createSiteAction).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Titre proposé par MemorIA', body: 'Corps proposé' }),
    )
  })

  it('titleOverride remplace le titre, sans toucher au corps', async () => {
    proposal = anActionProposal()
    await promoteProposal({
      id: 'prop-1', userId: 'u-1', organizationId: 'org-1',
      input: { titleOverride: 'Titre corrigé par Vincent' },
    })

    expect(createSiteAction).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Titre corrigé par Vincent', body: 'Corps proposé' }),
    )
  })

  it('bodyOverride remplace le corps, sans toucher au titre', async () => {
    proposal = anActionProposal()
    await promoteProposal({
      id: 'prop-1', userId: 'u-1', organizationId: 'org-1',
      input: { bodyOverride: 'Corps corrigé par Vincent' },
    })

    expect(createSiteAction).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Titre proposé par MemorIA', body: 'Corps corrigé par Vincent' }),
    )
  })

  it('un override vide (chaîne blanche) retombe sur le texte de la proposition', async () => {
    // trim() rend une chaîne blanche falsy : ce n'est pas un bug caché, c'est
    // le même garde-fou que dueDate applique déjà pour deadline.
    proposal = anActionProposal()
    await promoteProposal({
      id: 'prop-1', userId: 'u-1', organizationId: 'org-1',
      input: { titleOverride: '   ' },
    })

    expect(createSiteAction).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Titre proposé par MemorIA' }),
    )
  })
})
