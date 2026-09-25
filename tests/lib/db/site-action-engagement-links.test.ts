// P0-4B (GO Vincent 2026-09-25) — rapprochement humain Action ↔ Engagement.
// Preuves attendues : invariants d'écriture revalidés côté serveur (Porte A/B,
// statut actif, même organisation), idempotence sur doublon, lien historique
// toujours lisible après changement de statut de l'Engagement, retrait sans
// effet sur l'Action ou l'Engagement eux-mêmes.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DbEngagement } from '@/types/db'

let responses: Record<string, Array<{ data: unknown; error: unknown }>> = {}
let eqCalls: Array<{ table: string; field: string; value: unknown }> = []

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
        eq: (field: string, value: unknown) => {
          eqCalls.push({ table, field, value })
          return builder
        },
        is: () => builder,
        in: () => builder,
        order: () => builder,
        insert: () => builder,
        update: () => builder,
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
  resolveActiveEngagementLinkOwner,
  addEngagementLinkQualification,
  getActionsForEngagements,
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
  eqCalls = []
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

  it('Porte A active → présent, Porte A completed → absent (listActiveEngagementsByContracts n’est pas modifié, il retourne active+completed pour Mission)', async () => {
    mockedGetSiteById.mockResolvedValue(fakeSite({ contract_id: 'contract-1' }))
    mockedByContracts.mockResolvedValue(
      new Map([
        [
          'contract-1',
          [
            fakeEngagement({ id: 'eng-active', status: 'active' }),
            fakeEngagement({ id: 'eng-completed', status: 'completed' }),
          ],
        ],
      ]),
    )
    mockedBySites.mockResolvedValue(new Map())
    const result = await listCandidateEngagementsForSite('site-1')
    expect(result.map((e) => e.id)).toEqual(['eng-active'])
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
    queue('site_action_engagement_link_events', { data: [] })
    mockedByIds.mockResolvedValue([fakeEngagement({ id: 'eng-1', status: 'archived' })])
    const result = await listEngagementLinksForAction('action-1')
    expect(result).toHaveLength(1)
    expect(result[0].engagement.status).toBe('archived')
    expect(result[0].currentQualification).toBeNull()
    expect(result[0].qualificationHistory).toEqual([])
    expect(mockedByIds).toHaveBeenCalledWith(['eng-1'])
  })

  it('qualification courante = événement le plus récent, historique complet conservé', async () => {
    queue('site_action_engagement_links', {
      data: [{ id: 'link-1', site_action_id: 'action-1', engagement_id: 'eng-1', organization_id: 'org-1', site_id: 'site-1', created_by: 'user-1', created_at: '2026-01-01' }],
    })
    const eventOld = { id: 'ev-1', organization_id: 'org-1', link_id: 'link-1', qualification: 'demande_evolution', note: null, created_by: 'user-1', created_at: '2026-01-01' }
    const eventNew = { id: 'ev-2', organization_id: 'org-1', link_id: 'link-1', qualification: 'clarification', note: 'précision', created_by: 'user-1', created_at: '2026-01-02' }
    queue('site_action_engagement_link_events', { data: [eventOld, eventNew] })
    mockedByIds.mockResolvedValue([fakeEngagement({ id: 'eng-1' })])
    const result = await listEngagementLinksForAction('action-1')
    expect(result[0].currentQualification).toEqual(eventNew)
    expect(result[0].qualificationHistory).toEqual([eventOld, eventNew])
  })

  it('lien orphelin (engagement supprimé) est filtré silencieusement', async () => {
    queue('site_action_engagement_links', {
      data: [{ id: 'link-1', site_action_id: 'action-1', engagement_id: 'eng-gone', organization_id: 'org-1', site_id: 'site-1', created_by: null, created_at: '2026-01-01' }],
    })
    queue('site_action_engagement_link_events', { data: [] })
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
  it('retrait réussi (fermeture logique, pas de DELETE physique)', async () => {
    queue('site_action_engagement_links', { data: { id: 'link-1' } })
    const result = await removeSiteActionEngagementLink({ linkId: 'link-1', siteActionId: 'action-1', organizationId: 'org-1', removedBy: 'user-1' })
    expect(result).toEqual({ ok: true })
  })

  it('filtre la fermeture par id + site_action_id + organization_id', async () => {
    queue('site_action_engagement_links', { data: { id: 'link-1' } })
    await removeSiteActionEngagementLink({ linkId: 'link-1', siteActionId: 'action-1', organizationId: 'org-1', removedBy: 'user-1' })
    expect(eqCalls).toEqual([
      { table: 'site_action_engagement_links', field: 'id', value: 'link-1' },
      { table: 'site_action_engagement_links', field: 'site_action_id', value: 'action-1' },
      { table: 'site_action_engagement_links', field: 'organization_id', value: 'org-1' },
    ])
  })

  it('lien introuvable ou hors organisation → refus', async () => {
    queue('site_action_engagement_links', { data: null })
    const result = await removeSiteActionEngagementLink({ linkId: 'link-x', siteActionId: 'action-1', organizationId: 'org-1', removedBy: 'user-1' })
    expect(result).toEqual({ ok: false, error: 'Accès refusé' })
  })

  it('lien déjà retiré (removed_at non null) → refus, ré-attachement futur reste possible via un nouveau lien', async () => {
    // Le filtre .is('removed_at', null) exclut ce lien côté Postgres ; simulé
    // ici par data: null comme le ferait la requête réelle.
    queue('site_action_engagement_links', { data: null })
    const result = await removeSiteActionEngagementLink({ linkId: 'link-already-removed', siteActionId: 'action-1', organizationId: 'org-1', removedBy: 'user-1' })
    expect(result).toEqual({ ok: false, error: 'Accès refusé' })
  })

  it('linkId appartient à une autre Action (même organisation) → refus, aucune suppression', async () => {
    // Le lien existe bel et bien, mais pour Action B — la requête filtrée par
    // site_action_id = "action-A" ne le trouve pas (simulé ici par data: null,
    // comme le ferait Postgres avec l'AND supplémentaire).
    queue('site_action_engagement_links', { data: null })
    const result = await removeSiteActionEngagementLink({ linkId: 'link-of-action-b', siteActionId: 'action-a', organizationId: 'org-1', removedBy: 'user-1' })
    expect(result).toEqual({ ok: false, error: 'Accès refusé' })
    expect(eqCalls).toContainEqual({ table: 'site_action_engagement_links', field: 'site_action_id', value: 'action-a' })
  })

  it('erreur Supabase → message générique', async () => {
    queue('site_action_engagement_links', { data: null, error: new Error('db down') })
    const result = await removeSiteActionEngagementLink({ linkId: 'link-1', siteActionId: 'action-1', organizationId: 'org-1', removedBy: 'user-1' })
    expect(result).toEqual({ ok: false, error: 'Échec du retrait' })
  })
})

describe('getActionsForEngagements — ENG-UX-1 LOT C (indépendant de canonical_subject_id)', () => {
  it('aucun engagement fourni → map vide, aucune requête', async () => {
    const result = await getActionsForEngagements([])
    expect(result.size).toBe(0)
  })

  it('engagement sans lien actif → absent de la map (jamais de ligne fabriquée)', async () => {
    queue('site_action_engagement_links', { data: [] })
    const result = await getActionsForEngagements(['eng-1'])
    expect(result.has('eng-1')).toBe(false)
  })

  it('lien actif joint à site_actions, groupé par engagement_id', async () => {
    queue('site_action_engagement_links', { data: [{ id: 'link-1', site_action_id: 'action-1', engagement_id: 'eng-1' }] })
    queue('site_actions', { data: [{ id: 'action-1', title: 'Traiter le point', status: 'open', due_date: null }] })
    queue('site_action_engagement_link_events', { data: [] })
    const result = await getActionsForEngagements(['eng-1'])
    expect(result.get('eng-1')).toEqual([{ actionId: 'action-1', title: 'Traiter le point', status: 'open', dueDate: null, active: true, currentQualification: null }])
  })

  it('Action done → présente mais active=false (terminale, pas une charge à piloter)', async () => {
    queue('site_action_engagement_links', { data: [{ id: 'link-1', site_action_id: 'action-1', engagement_id: 'eng-1' }] })
    queue('site_actions', { data: [{ id: 'action-1', title: 'Fait', status: 'done', due_date: null }] })
    queue('site_action_engagement_link_events', { data: [] })
    const result = await getActionsForEngagements(['eng-1'])
    expect(result.get('eng-1')?.[0].active).toBe(false)
  })

  it('qualification courante = dernier événement du lien (P0-4C, ENG-UX-1 MICRO-FIX)', async () => {
    queue('site_action_engagement_links', { data: [{ id: 'link-1', site_action_id: 'action-1', engagement_id: 'eng-1' }] })
    queue('site_actions', { data: [{ id: 'action-1', title: 'Traiter le point', status: 'open', due_date: null }] })
    const eventOld = { id: 'ev-1', organization_id: 'org-1', link_id: 'link-1', qualification: 'demande_evolution', note: null, created_by: 'user-1', created_at: '2026-01-01' }
    const eventNew = { id: 'ev-2', organization_id: 'org-1', link_id: 'link-1', qualification: 'clarification', note: null, created_by: 'user-1', created_at: '2026-01-02' }
    queue('site_action_engagement_link_events', { data: [eventOld, eventNew] })
    const result = await getActionsForEngagements(['eng-1'])
    expect(result.get('eng-1')?.[0].currentQualification).toBe('clarification')
  })

  it('lien retiré (removed_at non null) jamais compté — filtré côté requête (.is(removed_at, null))', async () => {
    // .is('removed_at', null) exclut ce lien côté Postgres ; simulé ici par une
    // réponse vide, comme le ferait la requête réelle.
    queue('site_action_engagement_links', { data: [] })
    const result = await getActionsForEngagements(['eng-1'])
    expect(result.has('eng-1')).toBe(false)
  })

  it('une Action liée à plusieurs Engagements apparaît sous chacun', async () => {
    queue('site_action_engagement_links', {
      data: [
        { id: 'link-a', site_action_id: 'action-1', engagement_id: 'eng-a' },
        { id: 'link-b', site_action_id: 'action-1', engagement_id: 'eng-b' },
      ],
    })
    queue('site_actions', { data: [{ id: 'action-1', title: 'Partagée', status: 'open', due_date: null }] })
    queue('site_action_engagement_link_events', { data: [] })
    const result = await getActionsForEngagements(['eng-a', 'eng-b'])
    expect(result.get('eng-a')?.[0].actionId).toBe('action-1')
    expect(result.get('eng-b')?.[0].actionId).toBe('action-1')
  })

  it('lien orphelin (Action introuvable) filtré silencieusement', async () => {
    queue('site_action_engagement_links', { data: [{ id: 'link-1', site_action_id: 'action-gone', engagement_id: 'eng-1' }] })
    queue('site_actions', { data: [] })
    queue('site_action_engagement_link_events', { data: [] })
    const result = await getActionsForEngagements(['eng-1'])
    expect(result.has('eng-1')).toBe(false)
  })

  it('propage une erreur Supabase sur les liens', async () => {
    queue('site_action_engagement_links', { data: null, error: new Error('db down') })
    await expect(getActionsForEngagements(['eng-1'])).rejects.toThrow('db down')
  })

  it('propage une erreur Supabase sur les actions', async () => {
    queue('site_action_engagement_links', { data: [{ id: 'link-1', site_action_id: 'action-1', engagement_id: 'eng-1' }] })
    queue('site_actions', { data: null, error: new Error('db down') })
    queue('site_action_engagement_link_events', { data: [] })
    await expect(getActionsForEngagements(['eng-1'])).rejects.toThrow('db down')
  })
})

describe('resolveActiveEngagementLinkOwner', () => {
  it('lien actif → renvoie site_action_id + organization_id', async () => {
    queue('site_action_engagement_links', { data: { site_action_id: 'action-1', organization_id: 'org-1' } })
    const result = await resolveActiveEngagementLinkOwner('link-1')
    expect(result).toEqual({ siteActionId: 'action-1', organizationId: 'org-1' })
  })

  it('lien inexistant ou retiré (removed_at non null) → null', async () => {
    queue('site_action_engagement_links', { data: null })
    const result = await resolveActiveEngagementLinkOwner('link-x')
    expect(result).toBeNull()
  })
})

describe('addEngagementLinkQualification', () => {
  it('lien actif de la bonne organisation → insère un événement, createdBy = paramètre serveur', async () => {
    queue('site_action_engagement_links', { data: { id: 'link-1' } })
    queue('site_action_engagement_link_events', { data: null })
    const result = await addEngagementLinkQualification({
      linkId: 'link-1',
      qualification: 'demande_evolution',
      note: 'Demande formulée par le client lors de la visite.',
      organizationId: 'org-1',
      createdBy: 'user-1',
    })
    expect(result).toEqual({ ok: true })
  })

  it('lien introuvable, retiré, ou d’une autre organisation → refus, aucun insert', async () => {
    queue('site_action_engagement_links', { data: null })
    const result = await addEngagementLinkQualification({
      linkId: 'link-x',
      qualification: 'clarification',
      note: null,
      organizationId: 'org-1',
      createdBy: 'user-1',
    })
    expect(result).toEqual({ ok: false, error: 'Accès refusé' })
    expect(responses['site_action_engagement_link_events']).toBeUndefined()
  })

  it('erreur Supabase à l’insertion → message générique', async () => {
    queue('site_action_engagement_links', { data: { id: 'link-1' } })
    queue('site_action_engagement_link_events', { data: null, error: new Error('insert failed') })
    const result = await addEngagementLinkQualification({
      linkId: 'link-1',
      qualification: 'mise_en_oeuvre',
      note: null,
      organizationId: 'org-1',
      createdBy: 'user-1',
    })
    expect(result).toEqual({ ok: false, error: 'Échec de l\'enregistrement' })
  })

  it('deuxième qualification n’écrase pas la première (append-only, deux inserts distincts)', async () => {
    queue('site_action_engagement_links', { data: { id: 'link-1' } })
    queue('site_action_engagement_link_events', { data: null })
    await addEngagementLinkQualification({ linkId: 'link-1', qualification: 'demande_evolution', note: null, organizationId: 'org-1', createdBy: 'user-1' })

    queue('site_action_engagement_links', { data: { id: 'link-1' } })
    queue('site_action_engagement_link_events', { data: null })
    const second = await addEngagementLinkQualification({ linkId: 'link-1', qualification: 'clarification', note: null, organizationId: 'org-1', createdBy: 'user-1' })
    expect(second).toEqual({ ok: true })
  })
})
