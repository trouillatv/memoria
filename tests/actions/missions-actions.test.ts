// FIX_REQUIRED P0-3.5A #1 — createMissionAction/updateMissionAction ne
// doivent jamais faire confiance aux engagement_ids envoyés par le client :
// la population autorisée (Porte A du contrat du site actif/completed ∪
// Porte B du site lui-même active) est recalculée côté serveur à partir du
// site réel, jamais depuis la requête. En édition, les IDs déjà liés avant
// la mutation sont préservés même sortis de la population courante.
//
// FIX_REQUIRED P0-3.5A FINAL — l'autorisation d'écriture doit être résolue
// via requireSiteWriteAccess(siteId, 'managerOrAdmin') (rôle métier dans
// l'organisation DU SITE), jamais via users.role + appartenance seule. Un
// compte manager au niveau plateforme mais chef_equipe sur l'organisation du
// site ne doit pas pouvoir créer/modifier une Mission de ce chantier.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireSiteWriteAccess: vi.fn(),
  createMission: vi.fn(),
  updateMission: vi.fn(),
  getMission: vi.fn(),
  getSiteById: vi.fn(),
  listActiveEngagementsByContracts: vi.fn(),
  listActiveEngagementsBySites: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/lib/auth/site-write-access', () => ({ requireSiteWriteAccess: mocks.requireSiteWriteAccess }))
vi.mock('@/lib/db/missions', () => ({
  createMission: mocks.createMission,
  updateMission: mocks.updateMission,
  getMission: mocks.getMission,
}))
vi.mock('@/lib/db/sites', () => ({ getSiteById: mocks.getSiteById }))
vi.mock('@/lib/db/engagements', () => ({
  listActiveEngagementsByContracts: mocks.listActiveEngagementsByContracts,
  listActiveEngagementsBySites: mocks.listActiveEngagementsBySites,
}))

import { createMissionAction, updateMissionAction } from '@/app/(dashboard)/contracts/[id]/missions-actions'

const userId = '22222222-2222-4222-8222-222222222222'
const orgId = '99999999-9999-4999-8999-999999999999'
const siteId = '11111111-1111-4111-8111-111111111111'
const contractId = '33333333-3333-4333-8333-333333333333'
const engAllowedContract = '44444444-4444-4444-8444-444444444444'
const engAllowedSite = '55555555-5555-4555-8555-555555555555'
const engForeign = '66666666-6666-4666-8666-666666666666'
const engOldPreserved = '77777777-7777-4777-8777-777777777777'
const missionId = '88888888-8888-4888-8888-888888888888'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireSiteWriteAccess.mockResolvedValue({
    ok: true,
    organizationId: orgId,
    userId,
    role: 'manager',
  })
  mocks.getSiteById.mockResolvedValue({ id: siteId, contract_id: contractId })
  mocks.listActiveEngagementsByContracts.mockResolvedValue(
    new Map([[contractId, [{ id: engAllowedContract }]]])
  )
  mocks.listActiveEngagementsBySites.mockResolvedValue(
    new Map([[siteId, [{ id: engAllowedSite }]]])
  )
  mocks.createMission.mockResolvedValue(missionId)
})

function makeCreateFormData(engagementIds: string[]) {
  const fd = new FormData()
  fd.set('site_id', siteId)
  fd.set('name', 'Ma mission')
  fd.set('cadence', 'weekly')
  fd.set('engagement_ids', JSON.stringify(engagementIds))
  fd.set('default_checklist', JSON.stringify([]))
  return fd
}

describe('createMissionAction — recalcul serveur de la population (FIX #1)', () => {
  it('filtre un engagement_id hors population (Porte A/B du site) même envoyé par le client', async () => {
    const fd = makeCreateFormData([engAllowedContract, engAllowedSite, engForeign])

    const result = await createMissionAction(fd)

    expect(result).toEqual({ ok: true, missionId })
    expect(mocks.createMission).toHaveBeenCalledTimes(1)
    const payload = mocks.createMission.mock.calls[0][0]
    expect(payload.engagement_ids).toEqual([engAllowedContract, engAllowedSite])
    expect(payload.engagement_ids).not.toContain(engForeign)
  })

  it('referme un engagement_id de checklist hors population, jamais transmis au client (side-channel)', async () => {
    const fd = new FormData()
    fd.set('site_id', siteId)
    fd.set('name', 'Ma mission')
    fd.set('cadence', 'weekly')
    fd.set('engagement_ids', JSON.stringify([]))
    fd.set(
      'default_checklist',
      JSON.stringify([
        { label: 'Item autorisé', engagement_id: engAllowedSite },
        { label: 'Item étranger', engagement_id: engForeign },
      ]),
    )

    await createMissionAction(fd)

    const payload = mocks.createMission.mock.calls[0][0]
    expect(payload.default_checklist[0].engagement_id).toBe(engAllowedSite)
    expect(payload.default_checklist[1].engagement_id).toBeUndefined()
  })
})

describe('createMissionAction — autorisation M2C via requireSiteWriteAccess (FIX_REQUIRED FINAL)', () => {
  it("appelle requireSiteWriteAccess avec le site du formulaire et la police 'managerOrAdmin'", async () => {
    const fd = makeCreateFormData([engAllowedSite])

    await createMissionAction(fd)

    expect(mocks.requireSiteWriteAccess).toHaveBeenCalledWith(siteId, 'managerOrAdmin')
  })

  it('utilise access.userId (résolu par requireSiteWriteAccess) comme created_by, jamais un id client', async () => {
    const fd = makeCreateFormData([engAllowedSite])

    await createMissionAction(fd)

    const payload = mocks.createMission.mock.calls[0][0]
    expect(payload.created_by).toBe(userId)
  })

  it('refuse la création si requireSiteWriteAccess refuse le site (fail-closed)', async () => {
    mocks.requireSiteWriteAccess.mockResolvedValue({ ok: false, error: 'Accès refusé' })
    const fd = makeCreateFormData([engAllowedSite])

    const result = await createMissionAction(fd)

    expect(result).toEqual({ error: 'Accès refusé' })
    expect(mocks.createMission).not.toHaveBeenCalled()
  })

  it('membership chef_equipe sur le site (même avec un rôle plateforme plus élevé) refuse la création', async () => {
    // requireSiteWriteAccess encapsule cette divergence : la policy managerOrAdmin
    // exclut chef_equipe quel que soit users.role, qui n'est plus consulté ici.
    mocks.requireSiteWriteAccess.mockResolvedValue({ ok: false, error: 'Accès refusé' })
    const fd = makeCreateFormData([engAllowedSite])

    const result = await createMissionAction(fd)

    expect(result).toEqual({ error: 'Accès refusé' })
    expect(mocks.createMission).not.toHaveBeenCalled()
  })

  it('membership manager ou admin sur le site autorise la création', async () => {
    mocks.requireSiteWriteAccess.mockResolvedValue({ ok: true, organizationId: orgId, userId, role: 'admin' })
    const fd = makeCreateFormData([engAllowedSite])

    const result = await createMissionAction(fd)

    expect(result).toEqual({ ok: true, missionId })
    expect(mocks.createMission).toHaveBeenCalledTimes(1)
  })

  it('membership sur une autre organisation, suspendue ou absente renvoie le refus uniforme', async () => {
    mocks.requireSiteWriteAccess.mockResolvedValue({ ok: false, error: 'Accès refusé' })
    const fd = makeCreateFormData([engAllowedSite])

    const result = await createMissionAction(fd)

    expect(result).toEqual({ error: 'Accès refusé' })
    expect(mocks.createMission).not.toHaveBeenCalled()
  })
})

describe('updateMissionAction — recalcul serveur + préservation des liens historiques (FIX #1)', () => {
  it('préserve un engagement déjà lié sorti de la population, filtre un id étranger jamais lié', async () => {
    mocks.getMission.mockResolvedValue({
      id: missionId,
      site_id: siteId,
      engagement_ids: [engOldPreserved],
    })

    const fd = new FormData()
    fd.set('id', missionId)
    fd.set('engagement_ids', JSON.stringify([engOldPreserved, engAllowedSite, engForeign]))

    const result = await updateMissionAction(fd)

    expect(result).toEqual({ ok: true })
    expect(mocks.updateMission).toHaveBeenCalledTimes(1)
    const [, patch] = mocks.updateMission.mock.calls[0]
    expect(patch.engagement_ids).toEqual([engOldPreserved, engAllowedSite])
    expect(patch.engagement_ids).not.toContain(engForeign)
  })

  it('résout le site depuis la Mission elle-même, jamais depuis une valeur cliente', async () => {
    mocks.getMission.mockResolvedValue({
      id: missionId,
      site_id: siteId,
      engagement_ids: [],
    })

    const fd = new FormData()
    fd.set('id', missionId)
    fd.set('engagement_ids', JSON.stringify([engAllowedContract]))

    await updateMissionAction(fd)

    expect(mocks.getSiteById).toHaveBeenCalledWith(siteId)
  })

  it('referme un engagement_id de checklist hors population/préservation, jamais transmis au client (side-channel)', async () => {
    mocks.getMission.mockResolvedValue({
      id: missionId,
      site_id: siteId,
      engagement_ids: [engOldPreserved],
    })

    const fd = new FormData()
    fd.set('id', missionId)
    fd.set(
      'default_checklist',
      JSON.stringify([
        { label: 'Item autorisé', engagement_id: engAllowedSite },
        { label: 'Item préservé', engagement_id: engOldPreserved },
        { label: 'Item étranger', engagement_id: engForeign },
      ]),
    )

    await updateMissionAction(fd)

    const [, patch] = mocks.updateMission.mock.calls[0]
    expect(patch.default_checklist[0].engagement_id).toBe(engAllowedSite)
    expect(patch.default_checklist[1].engagement_id).toBe(engOldPreserved)
    expect(patch.default_checklist[2].engagement_id).toBeUndefined()
  })
})

describe('updateMissionAction — autorisation M2C via requireSiteWriteAccess (FIX_REQUIRED FINAL)', () => {
  it('appelle requireSiteWriteAccess avec le site DE LA MISSION (pas un site client), police managerOrAdmin', async () => {
    mocks.getMission.mockResolvedValue({
      id: missionId,
      site_id: siteId,
      engagement_ids: [],
    })

    const fd = new FormData()
    fd.set('id', missionId)
    fd.set('name', 'Renommage sans toucher aux engagements')

    await updateMissionAction(fd)

    expect(mocks.requireSiteWriteAccess).toHaveBeenCalledWith(siteId, 'managerOrAdmin')
  })

  it('renvoie le refus uniforme si la Mission est introuvable — aucun oracle d’existence', async () => {
    mocks.getMission.mockResolvedValue(null)

    const fd = new FormData()
    fd.set('id', missionId)
    fd.set('name', 'Mission inexistante')

    const result = await updateMissionAction(fd)

    expect(result).toEqual({ error: 'Accès refusé' })
    expect(mocks.requireSiteWriteAccess).not.toHaveBeenCalled()
    expect(mocks.updateMission).not.toHaveBeenCalled()
  })

  it('refuse la mise à jour si requireSiteWriteAccess refuse le site de la Mission (fail-closed), même sans engagement_ids soumis', async () => {
    mocks.getMission.mockResolvedValue({
      id: missionId,
      site_id: siteId,
      engagement_ids: [engOldPreserved],
    })
    mocks.requireSiteWriteAccess.mockResolvedValue({ ok: false, error: 'Accès refusé' })

    const fd = new FormData()
    fd.set('id', missionId)
    fd.set('name', 'Tentative cross-org')

    const result = await updateMissionAction(fd)

    expect(result).toEqual({ error: 'Accès refusé' })
    expect(mocks.updateMission).not.toHaveBeenCalled()
  })

  it('membership chef_equipe sur le site de la Mission (divergence multi-org) refuse la mise à jour', async () => {
    mocks.getMission.mockResolvedValue({
      id: missionId,
      site_id: siteId,
      engagement_ids: [],
    })
    mocks.requireSiteWriteAccess.mockResolvedValue({ ok: false, error: 'Accès refusé' })

    const fd = new FormData()
    fd.set('id', missionId)
    fd.set('name', 'Tentative avec membership chef_equipe')

    const result = await updateMissionAction(fd)

    expect(result).toEqual({ error: 'Accès refusé' })
    expect(mocks.updateMission).not.toHaveBeenCalled()
  })

  it('membership manager ou admin sur le site de la Mission autorise la mise à jour', async () => {
    mocks.getMission.mockResolvedValue({
      id: missionId,
      site_id: siteId,
      engagement_ids: [],
    })
    mocks.requireSiteWriteAccess.mockResolvedValue({ ok: true, organizationId: orgId, userId, role: 'admin' })

    const fd = new FormData()
    fd.set('id', missionId)
    fd.set('name', 'Mise à jour autorisée')

    const result = await updateMissionAction(fd)

    expect(result).toEqual({ ok: true })
    expect(mocks.updateMission).toHaveBeenCalledTimes(1)
  })

  it('membership sur une autre organisation, suspendue ou absente renvoie le refus uniforme', async () => {
    mocks.getMission.mockResolvedValue({
      id: missionId,
      site_id: siteId,
      engagement_ids: [],
    })
    mocks.requireSiteWriteAccess.mockResolvedValue({ ok: false, error: 'Accès refusé' })

    const fd = new FormData()
    fd.set('id', missionId)
    fd.set('name', 'Tentative depuis une autre organisation')

    const result = await updateMissionAction(fd)

    expect(result).toEqual({ error: 'Accès refusé' })
    expect(mocks.updateMission).not.toHaveBeenCalled()
  })
})
