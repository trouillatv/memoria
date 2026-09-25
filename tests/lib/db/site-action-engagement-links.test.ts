// P0-4B (GO Vincent 2026-09-25) — rapprochement humain Action ↔ Engagement.
// Preuves attendues : invariants d'écriture revalidés côté serveur (Porte A/B,
// statut actif, même organisation), idempotence sur doublon, lien historique
// toujours lisible après changement de statut de l'Engagement, retrait sans
// effet sur l'Action ou l'Engagement eux-mêmes.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DbEngagement } from '@/types/db'

let responses: Record<string, Array<{ data: unknown; error: unknown }>> = {}

function queue(table: string, response: { data: unknown; error?: unknown }) {
  if (!responses[table]) responses[table] = []
  responses[table].push({ data: response.data, error: response.error ?? null })
}

function nextResponse(table: string) {
  const q = responses[table]
  if (!q || q.length === 0) throw new Error(`No mocked response queued for table "${table}"`)
  return q.shift()!
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const response = nextResponse(table)
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        insert: () => builder,
        delete: () => builder,
        maybeSingle: () => Promise.resolve(response),
        single: () => Promise.resolve(response),
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve(response).then(resolve, reject),
      }
      return builder
    },
  }),
}))

vi.mock('@/lib/db/sites', () => ({
  getSiteById: vi.fn(),
}))

vi.mock('@/lib/db/engagements', () => ({
  listActiveEngagementsByContracts: vi.fn(),
  listActiveEngagementsBySites: vi.fn(),
  listEngagementsByIds: vi.fn(),
}))

import {
  listCandidateEngagementsForSite,
  listEngagementLinksForAction,
  createSiteActionEngagementLink,
  removeSiteActionEngagementLink,
} from '@/lib/db/site-action-engagement-links'
import { getSiteById } from '@/lib/db/sites'
import { listActiveEngagementsByContracts, listActiveEngagementsBySites, listEngagementsByIds } from '@/lib/db/engagements'

const mockedGetSiteById = vi.mocked(getSiteById)
const mockedByContracts = vi.mocked(listActiveEngagementsByContracts)
const mockedBySites = vi.mocked(listActiveEngagementsBySites)
const mockedByIds = vi.mocked(listEngagementsByIds)

function fakeSite(overrides: Record<string, unknown> = {}) {
  return { id: 'site-1', organization_id: 'org-1', contract_id: null, ...overrides } as unknown as Awaited<ReturnType<typeof getSiteById>>
}

function fakeEngagement(overrides: Partial<DbEngagement> = {}): DbEngagement {
  return {
    id: 'eng-1',
    short_label: 'Nettoyage hebdomadaire',
    status: 'active',
    site_id: null,
    contract_id: null,
    organization_id: 'org-1',
    ...overrides,
  } as unknown as DbEngagement
}

beforeEach(() => {
  responses = {}
  vi.clearAllMocks()
})

describe('listCandidateEngagementsForSite', () => {
  it('chantier introuvable → []', async () => {
    mockedGetSiteById.mockResolvedValue(null)
    const result = await listCandidateEngagementsForSite('site-x')
    expect(result).toEqual([])
    expect(mockedByContracts).not.toHaveBeenCalled()
  })

  it('sans contract_id : interroge uniquement Porte B', async () => {
    mockedGetSiteById.mockResolvedValue(fakeSite({ contract_id: null }))
    mockedBySites.mockResolvedValue(new Map([['site-1', [fakeEngagement({ id: 'eng-b' })]]]))
    const result = await listCandidateEngagementsForSite('site-1')
    expect(mockedByContracts).not.toHaveBeenCalled()
    expect(result.map((e) => e.id)).toEqual(['eng-b'])
  })

  it('Porte A ∪ Porte B dédupliquées par id', async () => {
    mockedGetSiteById.mockResolvedValue(fakeSite({ contract_id: 'contract-1' }))
    mockedByContracts.mockResolvedValue(new Map([['contract-1', [fakeEngagement({ id: 'eng-shared' }), fakeEngagement({ id: 'eng-a' })]]]))
    mockedBySites.mockResolvedValue(new Map([['site-1', [fakeEngagement({ id: 'eng-shared' }), fakeEngagement({ id: 'eng-b' })]]]))
    const result = await listCandidateEngagementsForSite('site-1')
    expect(result.map((e) => e.id).sort()).toEqual(['eng-a', 'eng-b', 'eng-shared'])
  })
})

describe('listEngagementLinksForAction', () => {
  it('aucun lien → []', async () => {
    queue('site_action_engagement_links', { data: [] })
    const result = await listEngagementLinksForAction('action-1')
    expect(result).toEqual([])
    expect(mockedByIds).not.toHaveBeenCalled()
  })

  it('lien historique toujours lisible même si l’engagement a changé de statut (archived)', async () => {
    queue('site_action_engagement_links', {
      data: [{ id: 'link-1', site_action_id: 'action-1', engagement_id: 'eng-1', organization_id: 'org-1', site_id: 'site-1', created_by: 'user-1', created_at: '2026-01-01' }],
    })
    mockedByIds.mockResolvedValue([fakeEngagement({ id: 'eng-1', status: 'archived' })])
    const result = await listEngagementLinksForAction('action-1')
    expect(result).toHaveLength(1)
    expect(result[0].engagement.status).toBe('archived')
    expect(mockedByIds).toHaveBeenCalledWith(['eng-1'])
  })

  it('lien orphelin (engagement supprimé) est filtré silencieusement', async () => {
    queue('site_action_engagement_links', {
      data: [{ id: 'link-1', site_action_id: 'action-1', engagement_id: 'eng-gone', organization_id: 'org-1', site_id: 'site-1', created_by: null, created_at: '2026-01-01' }],
    })
    mockedByIds.mockResolvedValue([])
    const result = await listEngagementLinksForAction('action-1')
    expect(result).toEqual([])
  })

  it('propage une erreur Supabase', async () => {
    queue('site_action_engagement_links', { data: null, error: new Error('db down') })
    await expect(listEngagementLinksForAction('action-1')).rejects.toThrow('db down')
  })
})

describe('createSiteActionEngagementLink', () => {
  const baseAction = { id: 'action-1', site_id: 'site-1', organization_id: 'org-1' }

  function queueHappyAction() {
    queue('site_actions', { data: baseAction })
  }

  it('Porte B, engagement actif, même chantier → autorisé', async () => {
    queueHappyAction()
    mockedGetSiteById.mockResolvedValue(fakeSite({ contract_id: null }))
    queue('engagements', { data: fakeEngagement({ id: 'eng-1', status: 'active', site_id: 'site-1', contract_id: null, organization_id: 'org-1' }) })
    queue('site_action_engagement_links', { data: null }) // pas de doublon existant
    queue('site_action_engagement_links', { data: { id: 'link-new' } }) // insert

    const result = await createSiteActionEngagementLink({ siteActionId: 'action-1', engagementId: 'eng-1', organizationId: 'org-1', createdBy: 'user-1' })
    expect(result).toEqual({ ok: true, id: 'link-new' })
  })

  it('Porte B, engagement curated (non actif) → refus', async () => {
    queueHappyAction()
    mockedGetSiteById.mockResolvedValue(fakeSite({ contract_id: null }))
    queue('engagements', { data: fakeEngagement({ id: 'eng-1', status: 'curated', site_id: 'site-1', organization_id: 'org-1' }) })

    const result = await createSiteActionEngagementLink({ siteActionId: 'action-1', engagementId: 'eng-1', organizationId: 'org-1', createdBy: 'user-1' })
    expect(result).toEqual({ ok: false, error: 'Cet engagement n\'est plus actif' })
  })

  it('Porte B, engagement completed → refus pour un NOUVEAU lien', async () => {
    queueHappyAction()
    mockedGetSiteById.mockResolvedValue(fakeSite({ contract_id: null }))
    queue('engagements', { data: fakeEngagement({ id: 'eng-1', status: 'completed', site_id: 'site-1', organization_id: 'org-1' }) })

    const result = await createSiteActionEngagementLink({ siteActionId: 'action-1', engagementId: 'eng-1', organizationId: 'org-1', createdBy: 'user-1' })
    expect(result.ok).toBe(false)
  })

  it('Porte B, engagement actif mais autre chantier (et pas de contrat commun) → refus', async () => {
    queueHappyAction()
    mockedGetSiteById.mockResolvedValue(fakeSite({ id: 'site-1', contract_id: null }))
    queue('engagements', { data: fakeEngagement({ id: 'eng-1', status: 'active', site_id: 'site-autre', contract_id: null, organization_id: 'org-1' }) })

    const result = await createSiteActionEngagementLink({ siteActionId: 'action-1', engagementId: 'eng-1', organizationId: 'org-1', createdBy: 'user-1' })
    expect(result).toEqual({ ok: false, error: 'Cet engagement ne s\'applique pas à ce chantier' })
  })

  it('Porte A, engagement actif du contrat du chantier → autorisé', async () => {
    queueHappyAction()
    mockedGetSiteById.mockResolvedValue(fakeSite({ contract_id: 'contract-1' }))
    queue('engagements', { data: fakeEngagement({ id: 'eng-1', status: 'active', site_id: null, contract_id: 'contract-1', organization_id: 'org-1' }) })
    queue('site_action_engagement_links', { data: null })
    queue('site_action_engagement_links', { data: { id: 'link-new' } })

    const result = await createSiteActionEngagementLink({ siteActionId: 'action-1', engagementId: 'eng-1', organizationId: 'org-1', createdBy: 'user-1' })
    expect(result).toEqual({ ok: true, id: 'link-new' })
  })

  it('Porte A, engagement actif d’un AUTRE contrat → refus', async () => {
    queueHappyAction()
    mockedGetSiteById.mockResolvedValue(fakeSite({ contract_id: 'contract-1' }))
    queue('engagements', { data: fakeEngagement({ id: 'eng-1', status: 'active', site_id: null, contract_id: 'contract-autre', organization_id: 'org-1' }) })

    const result = await createSiteActionEngagementLink({ siteActionId: 'action-1', engagementId: 'eng-1', organizationId: 'org-1', createdBy: 'user-1' })
    expect(result).toEqual({ ok: false, error: 'Cet engagement ne s\'applique pas à ce chantier' })
  })

  it('Action d’une autre organisation → refus', async () => {
    queue('site_actions', { data: { ...baseAction, organization_id: 'org-autre' } })

    const result = await createSiteActionEngagementLink({ siteActionId: 'action-1', engagementId: 'eng-1', organizationId: 'org-1', createdBy: 'user-1' })
    expect(result).toEqual({ ok: false, error: 'Accès refusé' })
    expect(mockedGetSiteById).not.toHaveBeenCalled()
  })

  it('Engagement d’une autre organisation → refus', async () => {
    queueHappyAction()
    mockedGetSiteById.mockResolvedValue(fakeSite({ contract_id: null }))
    queue('engagements', { data: fakeEngagement({ id: 'eng-1', status: 'active', site_id: 'site-1', organization_id: 'org-autre' }) })

    const result = await createSiteActionEngagementLink({ siteActionId: 'action-1', engagementId: 'eng-1', organizationId: 'org-1', createdBy: 'user-1' })
    expect(result).toEqual({ ok: false, error: 'Accès refusé' })
  })

  it('Action introuvable → refus', async () => {
    queue('site_actions', { data: null })

    const result = await createSiteActionEngagementLink({ siteActionId: 'action-x', engagementId: 'eng-1', organizationId: 'org-1', createdBy: 'user-1' })
    expect(result).toEqual({ ok: false, error: 'Accès refusé' })
  })

  it('doublon : lien déjà existant → idempotence (succès, pas de second insert)', async () => {
    queueHappyAction()
    mockedGetSiteById.mockResolvedValue(fakeSite({ contract_id: null }))
    queue('engagements', { data: fakeEngagement({ id: 'eng-1', status: 'active', site_id: 'site-1', organization_id: 'org-1' }) })
    queue('site_action_engagement_links', { data: { id: 'link-existing' } })

    const result = await createSiteActionEngagementLink({ siteActionId: 'action-1', engagementId: 'eng-1', organizationId: 'org-1', createdBy: 'user-1' })
    expect(result).toEqual({ ok: true, id: 'link-existing' })
    expect(responses['site_action_engagement_links']).toEqual([])
  })

  it('échec de l’insertion → message générique', async () => {
    queueHappyAction()
    mockedGetSiteById.mockResolvedValue(fakeSite({ contract_id: null }))
    queue('engagements', { data: fakeEngagement({ id: 'eng-1', status: 'active', site_id: 'site-1', organization_id: 'org-1' }) })
    queue('site_action_engagement_links', { data: null })
    queue('site_action_engagement_links', { data: null, error: new Error('insert failed') })

    const result = await createSiteActionEngagementLink({ siteActionId: 'action-1', engagementId: 'eng-1', organizationId: 'org-1', createdBy: 'user-1' })
    expect(result).toEqual({ ok: false, error: 'Échec de l\'enregistrement' })
  })
})

describe('removeSiteActionEngagementLink', () => {
  it('retrait réussi', async () => {
    queue('site_action_engagement_links', { data: { id: 'link-1' } })
    const result = await removeSiteActionEngagementLink({ linkId: 'link-1', organizationId: 'org-1' })
    expect(result).toEqual({ ok: true })
  })

  it('lien introuvable ou hors organisation → refus', async () => {
    queue('site_action_engagement_links', { data: null })
    const result = await removeSiteActionEngagementLink({ linkId: 'link-x', organizationId: 'org-1' })
    expect(result).toEqual({ ok: false, error: 'Accès refusé' })
  })

  it('erreur Supabase → message générique', async () => {
    queue('site_action_engagement_links', { data: null, error: new Error('db down') })
    const result = await removeSiteActionEngagementLink({ linkId: 'link-1', organizationId: 'org-1' })
    expect(result).toEqual({ ok: false, error: 'Échec du retrait' })
  })
})
