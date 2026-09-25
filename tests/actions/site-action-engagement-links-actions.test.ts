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
  resolveActiveEngagementLinkOwner: vi.fn(),
  addEngagementLinkQualification: vi.fn(),
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
  resolveActiveEngagementLinkOwner: mocks.resolveActiveEngagementLinkOwner,
  addEngagementLinkQualification: mocks.addEngagementLinkQualification,
}))

import {
  listCandidateEngagementsForActionAction,
  listEngagementLinksForActionAction,
  createEngagementLinkAction,
  removeEngagementLinkAction,
  qualifyEngagementLinkAction,
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
  mocks.resolveActiveEngagementLinkOwner.mockResolvedValue({ siteActionId: actionId, organizationId: 'org-1' })
  mocks.addEngagementLinkQualification.mockResolvedValue({ ok: true })
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

  it('succès : retire le lien via son organizationId authentifié, scope siteActionId=actionId, et revalide', async () => {
    const result = await removeEngagementLinkAction(removeFormData())
    expect(mocks.removeSiteActionEngagementLink).toHaveBeenCalledWith({
      linkId,
      siteActionId: actionId,
      organizationId: 'org-1',
      removedBy: 'user-1',
    })
    expect(result).toEqual({ ok: true })
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/sites/${siteId}`)
  })

  it('linkId appartenant à une autre Action → le DB helper refuse (scopé par siteActionId), aucune revalidation', async () => {
    mocks.removeSiteActionEngagementLink.mockResolvedValue({ ok: false, error: 'Accès refusé' })
    const result = await removeEngagementLinkAction(removeFormData())
    expect(mocks.removeSiteActionEngagementLink).toHaveBeenCalledWith({
      linkId,
      siteActionId: actionId,
      organizationId: 'org-1',
      removedBy: 'user-1',
    })
    expect(result).toEqual({ ok: false, error: 'Accès refusé' })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
})

describe('qualifyEngagementLinkAction', () => {
  function qualifyFormData(overrides: Record<string, string> = {}) {
    const fd = new FormData()
    fd.set('linkId', linkId)
    fd.set('qualification', 'demande_evolution')
    fd.set('siteId', siteId)
    for (const [k, v] of Object.entries(overrides)) fd.set(k, v)
    return fd
  }

  it('saisie invalide (qualification hors des 4 valeurs V1) → refuse sans résoudre le lien', async () => {
    const result = await qualifyEngagementLinkAction(qualifyFormData({ qualification: 'conforme' }))
    expect(result).toEqual({ ok: false, error: 'Saisie invalide' })
    expect(mocks.resolveActiveEngagementLinkOwner).not.toHaveBeenCalled()
  })

  it('linkId inexistant → refus uniforme sans appeler la frontière M2C', async () => {
    mocks.resolveActiveEngagementLinkOwner.mockResolvedValue(null)
    const result = await qualifyEngagementLinkAction(qualifyFormData())
    expect(result).toEqual({ ok: false, error: 'Accès refusé' })
    expect(mocks.requireSiteActionWriteAccess).not.toHaveBeenCalled()
    expect(mocks.addEngagementLinkQualification).not.toHaveBeenCalled()
  })

  it('lien retiré (removed_at non null) → resolveActiveEngagementLinkOwner retourne null → refus', async () => {
    mocks.resolveActiveEngagementLinkOwner.mockResolvedValue(null)
    const result = await qualifyEngagementLinkAction(qualifyFormData())
    expect(result).toEqual({ ok: false, error: 'Accès refusé' })
  })

  it('dérive site_action_id DU LIEN, jamais d’un actionId fourni par le client', async () => {
    await qualifyEngagementLinkAction(qualifyFormData())
    expect(mocks.resolveActiveEngagementLinkOwner).toHaveBeenCalledWith(linkId)
    expect(mocks.requireSiteActionWriteAccess).toHaveBeenCalledWith(actionId, 'managerOrAdmin')
  })

  it('accès refusé (chef_equipe) → aucune écriture', async () => {
    mocks.requireSiteActionWriteAccess.mockResolvedValue({ ok: false, error: 'Accès refusé' })
    const result = await qualifyEngagementLinkAction(qualifyFormData())
    expect(result).toEqual({ ok: false, error: 'Accès refusé' })
    expect(mocks.addEngagementLinkQualification).not.toHaveBeenCalled()
  })

  it('accès autorisé (admin) → autorisé', async () => {
    mocks.requireSiteActionWriteAccess.mockResolvedValue(accessOk('admin'))
    const result = await qualifyEngagementLinkAction(qualifyFormData())
    expect(result).toEqual({ ok: true })
  })

  it('lien d’une autre organisation que l’accès résolu → refus même si requireSiteActionWriteAccess réussit', async () => {
    mocks.resolveActiveEngagementLinkOwner.mockResolvedValue({ siteActionId: actionId, organizationId: 'org-2' })
    const result = await qualifyEngagementLinkAction(qualifyFormData())
    expect(result).toEqual({ ok: false, error: 'Accès refusé' })
    expect(mocks.addEngagementLinkQualification).not.toHaveBeenCalled()
  })

  it('écrit avec createdBy = userId authentifié, jamais un champ client', async () => {
    await qualifyEngagementLinkAction(qualifyFormData({ qualification: 'clarification' }))
    expect(mocks.addEngagementLinkQualification).toHaveBeenCalledWith({
      linkId,
      qualification: 'clarification',
      note: null,
      organizationId: 'org-1',
      createdBy: 'user-1',
    })
  })

  it('accepte les 4 qualifications V1', async () => {
    for (const q of ['demande_evolution', 'mise_en_oeuvre', 'ecart_a_examiner', 'clarification']) {
      mocks.addEngagementLinkQualification.mockClear()
      const result = await qualifyEngagementLinkAction(qualifyFormData({ qualification: q }))
      expect(result).toEqual({ ok: true })
      expect(mocks.addEngagementLinkQualification).toHaveBeenCalledWith(
        expect.objectContaining({ qualification: q }),
      )
    }
  })

  it('note optionnelle transmise telle quelle', async () => {
    await qualifyEngagementLinkAction(qualifyFormData({ note: 'Demande formulée par le client lors de la visite.' }))
    expect(mocks.addEngagementLinkQualification).toHaveBeenCalledWith(
      expect.objectContaining({ note: 'Demande formulée par le client lors de la visite.' }),
    )
  })

  it('succès : revalide les surfaces Action', async () => {
    await qualifyEngagementLinkAction(qualifyFormData())
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/actions')
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/sites/${siteId}`)
  })

  it('le DB helper refuse → propage l’erreur sans revalider', async () => {
    mocks.addEngagementLinkQualification.mockResolvedValue({ ok: false, error: 'Échec de l\'enregistrement' })
    const result = await qualifyEngagementLinkAction(qualifyFormData())
    expect(result).toEqual({ ok: false, error: 'Échec de l\'enregistrement' })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
})
