// P0-4B (GO Vincent 2026-09-25) — server actions Action ↔ Engagement.
// Preuves : validation zod, frontière M2C (requireSiteActionWriteAccess /
// requireSiteWriteAccess) avec policy managerOrAdmin, aucune écriture si
// l'accès est refusé, revalidation des surfaces Action après succès.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireSiteWriteAccess: vi.fn(),
  requireSiteActionWriteAccess: vi.fn(),
  listCandidateEngagementsForSite: vi.fn(),
  listEngagementLinksForAction: vi.fn(),
  createSiteActionEngagementLink: vi.fn(),
  removeSiteActionEngagementLink: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/lib/auth/site-write-access', () => ({
  requireSiteWriteAccess: mocks.requireSiteWriteAccess,
  requireSiteActionWriteAccess: mocks.requireSiteActionWriteAccess,
}))
vi.mock('@/lib/db/site-action-engagement-links', () => ({
  listCandidateEngagementsForSite: mocks.listCandidateEngagementsForSite,
  listEngagementLinksForAction: mocks.listEngagementLinksForAction,
  createSiteActionEngagementLink: mocks.createSiteActionEngagementLink,
  removeSiteActionEngagementLink: mocks.removeSiteActionEngagementLink,
}))

import {
  listCandidateEngagementsForActionAction,
  listEngagementLinksForActionAction,
  createEngagementLinkAction,
  removeEngagementLinkAction,
} from '@/app/(dashboard)/actions/actions'

const siteId = '11111111-1111-4111-8111-111111111111'
const actionId = '22222222-2222-4222-8222-222222222222'
const engagementId = '33333333-3333-4333-8333-333333333333'
const linkId = '44444444-4444-4444-8444-444444444444'

function accessOk(role: 'admin' | 'manager' = 'manager') {
  return { ok: true, organizationId: 'org-1', userId: 'user-1', role }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireSiteWriteAccess.mockResolvedValue(accessOk())
  mocks.requireSiteActionWriteAccess.mockResolvedValue(accessOk())
  mocks.createSiteActionEngagementLink.mockResolvedValue({ ok: true, id: 'link-99' })
  mocks.removeSiteActionEngagementLink.mockResolvedValue({ ok: true })
})

describe('listCandidateEngagementsForActionAction', () => {
  it('siteId invalide → [] sans appeler requireSiteWriteAccess', async () => {
    const result = await listCandidateEngagementsForActionAction('not-a-uuid')
    expect(result).toEqual([])
    expect(mocks.requireSiteWriteAccess).not.toHaveBeenCalled()
  })

  it('accès refusé (chef_equipe) → [] sans lecture', async () => {
    mocks.requireSiteWriteAccess.mockResolvedValue({ ok: false, error: 'Accès refusé' })
    const result = await listCandidateEngagementsForActionAction(siteId)
    expect(result).toEqual([])
    expect(mocks.listCandidateEngagementsForSite).not.toHaveBeenCalled()
  })

  it('accès autorisé (manager) → délègue au DB helper avec policy managerOrAdmin', async () => {
    mocks.listCandidateEngagementsForSite.mockResolvedValue([{ id: 'eng-1' }])
    const result = await listCandidateEngagementsForActionAction(siteId)
    expect(mocks.requireSiteWriteAccess).toHaveBeenCalledWith(siteId, 'managerOrAdmin')
    expect(result).toEqual([{ id: 'eng-1' }])
  })
})

describe('listEngagementLinksForActionAction', () => {
  it('actionId invalide → []', async () => {
    const result = await listEngagementLinksForActionAction('not-a-uuid')
    expect(result).toEqual([])
    expect(mocks.requireSiteActionWriteAccess).not.toHaveBeenCalled()
  })

  it('accès refusé → []', async () => {
    mocks.requireSiteActionWriteAccess.mockResolvedValue({ ok: false, error: 'Accès refusé' })
    const result = await listEngagementLinksForActionAction(actionId)
    expect(result).toEqual([])
    expect(mocks.listEngagementLinksForAction).not.toHaveBeenCalled()
  })

  it('accès autorisé → délègue au DB helper', async () => {
    mocks.listEngagementLinksForAction.mockResolvedValue([{ link: {}, engagement: {} }])
    const result = await listEngagementLinksForActionAction(actionId)
    expect(mocks.requireSiteActionWriteAccess).toHaveBeenCalledWith(actionId, 'managerOrAdmin')
    expect(result).toEqual([{ link: {}, engagement: {} }])
  })
})

function linkFormData(overrides: Record<string, string> = {}) {
  const fd = new FormData()
  fd.set('actionId', actionId)
  fd.set('engagementId', engagementId)
  fd.set('siteId', siteId)
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v)
  return fd
}

describe('createEngagementLinkAction', () => {
  it('saisie invalide (engagementId non-uuid) → refuse sans appeler la frontière', async () => {
    const result = await createEngagementLinkAction(linkFormData({ engagementId: 'not-a-uuid' }))
    expect(result).toEqual({ ok: false, error: 'Saisie invalide' })
    expect(mocks.requireSiteActionWriteAccess).not.toHaveBeenCalled()
  })

  it('accès refusé (chef_equipe) → aucune écriture', async () => {
    mocks.requireSiteActionWriteAccess.mockResolvedValue({ ok: false, error: 'Accès refusé' })
    const result = await createEngagementLinkAction(linkFormData())
    expect(result).toEqual({ ok: false, error: 'Accès refusé' })
    expect(mocks.createSiteActionEngagementLink).not.toHaveBeenCalled()
  })

  it('accès autorisé (manager/admin) → écrit avec userId authentifié comme createdBy, jamais un champ client', async () => {
    const result = await createEngagementLinkAction(linkFormData())
    expect(mocks.requireSiteActionWriteAccess).toHaveBeenCalledWith(actionId, 'managerOrAdmin')
    expect(mocks.createSiteActionEngagementLink).toHaveBeenCalledWith({
      siteActionId: actionId,
      engagementId,
      organizationId: 'org-1',
      createdBy: 'user-1',
    })
    expect(result).toEqual({ ok: true })
  })

  it('succès : revalide les surfaces Action (globales + celles du chantier)', async () => {
    await createEngagementLinkAction(linkFormData())
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/actions')
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/sites/${siteId}`)
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/sites/${siteId}/actions`)
  })

  it('le DB helper refuse (ex: engagement non actif) → propage l’erreur sans revalider', async () => {
    mocks.createSiteActionEngagementLink.mockResolvedValue({ ok: false, error: 'Cet engagement n\'est plus actif' })
    const result = await createEngagementLinkAction(linkFormData())
    expect(result).toEqual({ ok: false, error: 'Cet engagement n\'est plus actif' })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
})

describe('removeEngagementLinkAction', () => {
  function removeFormData(overrides: Record<string, string> = {}) {
    const fd = new FormData()
    fd.set('linkId', linkId)
    fd.set('actionId', actionId)
    fd.set('siteId', siteId)
    for (const [k, v] of Object.entries(overrides)) fd.set(k, v)
    return fd
  }

  it('saisie invalide → refuse sans appeler la frontière', async () => {
    const result = await removeEngagementLinkAction(removeFormData({ linkId: 'not-a-uuid' }))
    expect(result).toEqual({ ok: false, error: 'Saisie invalide' })
    expect(mocks.requireSiteActionWriteAccess).not.toHaveBeenCalled()
  })

  it('accès refusé → aucun retrait', async () => {
    mocks.requireSiteActionWriteAccess.mockResolvedValue({ ok: false, error: 'Accès refusé' })
    const result = await removeEngagementLinkAction(removeFormData())
    expect(result).toEqual({ ok: false, error: 'Accès refusé' })
    expect(mocks.removeSiteActionEngagementLink).not.toHaveBeenCalled()
  })

  it('l’autorité racine est l’Action (M2C), pas l’Engagement', async () => {
    await removeEngagementLinkAction(removeFormData())
    expect(mocks.requireSiteActionWriteAccess).toHaveBeenCalledWith(actionId, 'managerOrAdmin')
  })

  it('succès : retire le lien via son organizationId authentifié et revalide', async () => {
    const result = await removeEngagementLinkAction(removeFormData())
    expect(mocks.removeSiteActionEngagementLink).toHaveBeenCalledWith({ linkId, organizationId: 'org-1' })
    expect(result).toEqual({ ok: true })
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/sites/${siteId}`)
  })
})
