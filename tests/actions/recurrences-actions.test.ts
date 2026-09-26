// PLAN-SEC-1 FINAL — review du SHA e8a94b8f (mandat Vincent 2026-09-26).
//
// Le trou cross-tenant brut était fermé, mais la politique de rôle restait
// incorrecte : requireManagerOrAdmin() lit users.role (profil global) et
// requireOwned(auth.role, 'missions', missionId) ne vérifie que
// l'appartenance de l'appelant à l'organisation de la mission — jamais son
// rôle DANS cette organisation. Un compte manager au niveau plateforme mais
// chef_equipe (ou tout rôle non habilité) sur l'organisation propriétaire du
// chantier ciblé passait quand même les deux contrôles.
//
// requireSiteWriteAccess(siteId, 'managerOrAdmin') résout l'organisation ET
// le rôle DANS cette même organisation — remplace requireManagerOrAdmin() +
// requireOwned() comme politique de rôle des trois mutations. Le site vient
// TOUJOURS de la Mission persistée (mission_id client pour la création,
// existing.mission_id du template persisté pour update/archive), jamais
// d'un contract_id client.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireSiteWriteAccess: vi.fn(),
  getMission: vi.fn(),
  getTemplate: vi.fn(),
  rpc: vi.fn(),
  archiveTemplate: vi.fn(),
  logAuditEvent: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/lib/auth/site-write-access', () => ({ requireSiteWriteAccess: mocks.requireSiteWriteAccess }))
vi.mock('@/lib/db/missions', () => ({ getMission: mocks.getMission }))
vi.mock('@/lib/db/intervention-templates', () => ({
  getTemplate: mocks.getTemplate,
  archiveTemplate: mocks.archiveTemplate,
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ rpc: mocks.rpc }),
}))
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: mocks.logAuditEvent }))

import {
  createRecurrenceAction,
  updateRecurrenceAction,
  archiveRecurrenceAction,
} from '@/app/(dashboard)/contracts/[id]/recurrences-actions'

const userId = '22222222-2222-4222-8222-222222222222'
const orgId = '99999999-9999-4999-8999-999999999999'
const siteId = '11111111-1111-4111-8111-111111111111'
const missionId = '88888888-8888-4888-8888-888888888888'
const templateId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const REFUS = 'Accès refusé'

function makeCreateInput(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    mission_id: missionId,
    frequency: 'daily' as const,
    slots: [],
    starts_on: '2026-09-26',
    ...overrides,
  }
}

function makeUpdateInput(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    templateId,
    frequency: 'daily' as const,
    slots: [],
    starts_on: '2026-09-26',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireSiteWriteAccess.mockResolvedValue({
    ok: true,
    organizationId: orgId,
    userId,
    role: 'manager',
  })
  mocks.getMission.mockResolvedValue({ id: missionId, site_id: siteId, name: 'Nettoyage magasin' })
  mocks.getTemplate.mockResolvedValue({ id: templateId, mission_id: missionId, title: 'Nettoyage magasin' })
  mocks.rpc.mockResolvedValue({ data: { template_id: templateId }, error: null })
})

describe('createRecurrenceAction — autorisation M2C via requireSiteWriteAccess (PLAN-SEC-1 FINAL)', () => {
  it('charge la Mission RÉELLE depuis mission_id puis appelle requireSiteWriteAccess avec son site_id, police managerOrAdmin', async () => {
    await createRecurrenceAction(makeCreateInput())

    expect(mocks.getMission).toHaveBeenCalledWith(missionId)
    expect(mocks.requireSiteWriteAccess).toHaveBeenCalledWith(siteId, 'managerOrAdmin')
  })

  it('utilise access.userId (résolu par requireSiteWriteAccess) comme created_by, jamais un id client', async () => {
    await createRecurrenceAction(makeCreateInput())

    const [, payload] = mocks.rpc.mock.calls[0]
    expect(payload.p_created_by).toBe(userId)
  })

  it('renvoie le refus uniforme si la Mission est introuvable — aucun oracle, requireSiteWriteAccess jamais appelé', async () => {
    mocks.getMission.mockResolvedValue(null)

    const result = await createRecurrenceAction(makeCreateInput())

    expect(result).toEqual({ ok: false, error: REFUS })
    expect(mocks.requireSiteWriteAccess).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('users.role=manager + membershipRole=manager sur le site de la Mission → autorisé', async () => {
    mocks.requireSiteWriteAccess.mockResolvedValue({ ok: true, organizationId: orgId, userId, role: 'manager' })

    const result = await createRecurrenceAction(makeCreateInput())

    expect(result).toEqual({ ok: true, templateId })
    expect(mocks.rpc).toHaveBeenCalledWith('fn_plan_create_simple_template_exclusive', expect.objectContaining({ p_mission_id: missionId }))
  })

  it('users.role=manager + membershipRole insuffisant (non manager/admin) sur le site de la Mission → refus uniforme', async () => {
    // requireSiteWriteAccess encapsule cette divergence : la policy managerOrAdmin
    // exclut chef_equipe/autre quel que soit users.role, qui n'est plus consulté.
    mocks.requireSiteWriteAccess.mockResolvedValue({ ok: false, error: REFUS })

    const result = await createRecurrenceAction(makeCreateInput())

    expect(result).toEqual({ ok: false, error: REFUS })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('membership absente sur l’organisation du site de la Mission → refus uniforme', async () => {
    mocks.requireSiteWriteAccess.mockResolvedValue({ ok: false, error: REFUS })

    const result = await createRecurrenceAction(makeCreateInput())

    expect(result).toEqual({ ok: false, error: REFUS })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('Mission appartenant à un autre tenant (site d’une autre organisation) → refus uniforme', async () => {
    mocks.requireSiteWriteAccess.mockResolvedValue({ ok: false, error: REFUS })

    const result = await createRecurrenceAction(makeCreateInput())

    expect(result).toEqual({ ok: false, error: REFUS })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('ne fait jamais confiance à contract_id client pour l’autorisation (site vient uniquement de la Mission)', async () => {
    await createRecurrenceAction(makeCreateInput({ contract_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }))

    expect(mocks.requireSiteWriteAccess).toHaveBeenCalledWith(siteId, 'managerOrAdmin')
    expect(mocks.requireSiteWriteAccess).not.toHaveBeenCalledWith('ffffffff-ffff-4fff-8fff-ffffffffffff', expect.anything())
  })
})

describe('updateRecurrenceAction — autorisation M2C via requireSiteWriteAccess (PLAN-SEC-1 FINAL)', () => {
  it('charge le template PUIS la Mission DU TEMPLATE, appelle requireSiteWriteAccess avec le site de cette Mission', async () => {
    await updateRecurrenceAction(makeUpdateInput())

    expect(mocks.getTemplate).toHaveBeenCalledWith(templateId)
    expect(mocks.getMission).toHaveBeenCalledWith(missionId)
    expect(mocks.requireSiteWriteAccess).toHaveBeenCalledWith(siteId, 'managerOrAdmin')
  })

  it('utilise access.userId comme userId d’audit, jamais un id client', async () => {
    await updateRecurrenceAction(makeUpdateInput())

    const auditCall = mocks.logAuditEvent.mock.calls[0][0]
    expect(auditCall.userId).toBe(userId)
  })

  it('renvoie le refus uniforme si le template est introuvable — aucun oracle, requireSiteWriteAccess jamais appelé', async () => {
    mocks.getTemplate.mockResolvedValue(null)

    const result = await updateRecurrenceAction(makeUpdateInput())

    expect(result).toEqual({ ok: false, error: REFUS })
    expect(mocks.getMission).not.toHaveBeenCalled()
    expect(mocks.requireSiteWriteAccess).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('renvoie le refus uniforme si la Mission du template est introuvable — même message que template introuvable', async () => {
    mocks.getMission.mockResolvedValue(null)

    const result = await updateRecurrenceAction(makeUpdateInput())

    expect(result).toEqual({ ok: false, error: REFUS })
    expect(mocks.requireSiteWriteAccess).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('users.role=manager + membershipRole=manager sur le site de la Mission du template → autorisé', async () => {
    mocks.requireSiteWriteAccess.mockResolvedValue({ ok: true, organizationId: orgId, userId, role: 'manager' })

    const result = await updateRecurrenceAction(makeUpdateInput())

    expect(result).toEqual({ ok: true, templateId })
    expect(mocks.rpc).toHaveBeenCalledWith('fn_plan_update_simple_template_exclusive', expect.objectContaining({ p_template_id: templateId }))
  })

  it('users.role=manager + membershipRole insuffisant sur le site de la Mission du template → refus uniforme (fail-closed)', async () => {
    mocks.requireSiteWriteAccess.mockResolvedValue({ ok: false, error: REFUS })

    const result = await updateRecurrenceAction(makeUpdateInput())

    expect(result).toEqual({ ok: false, error: REFUS })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('membership absente sur l’organisation du site → refus uniforme', async () => {
    mocks.requireSiteWriteAccess.mockResolvedValue({ ok: false, error: REFUS })

    const result = await updateRecurrenceAction(makeUpdateInput())

    expect(result).toEqual({ ok: false, error: REFUS })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('template dont la Mission appartient à un autre tenant → refus uniforme', async () => {
    mocks.requireSiteWriteAccess.mockResolvedValue({ ok: false, error: REFUS })

    const result = await updateRecurrenceAction(makeUpdateInput())

    expect(result).toEqual({ ok: false, error: REFUS })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('ne fait jamais confiance à contract_id client pour l’autorisation', async () => {
    await updateRecurrenceAction(makeUpdateInput({ contract_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }))

    expect(mocks.requireSiteWriteAccess).toHaveBeenCalledWith(siteId, 'managerOrAdmin')
  })
})

describe('archiveRecurrenceAction — autorisation M2C via requireSiteWriteAccess (PLAN-SEC-1 FINAL)', () => {
  it('charge le template PUIS la Mission DU TEMPLATE, appelle requireSiteWriteAccess avec le site de cette Mission', async () => {
    await archiveRecurrenceAction({ templateId })

    expect(mocks.getTemplate).toHaveBeenCalledWith(templateId)
    expect(mocks.getMission).toHaveBeenCalledWith(missionId)
    expect(mocks.requireSiteWriteAccess).toHaveBeenCalledWith(siteId, 'managerOrAdmin')
  })

  it('renvoie le refus uniforme si le template est introuvable', async () => {
    mocks.getTemplate.mockResolvedValue(null)

    const result = await archiveRecurrenceAction({ templateId })

    expect(result).toEqual({ ok: false, error: REFUS })
    expect(mocks.requireSiteWriteAccess).not.toHaveBeenCalled()
    expect(mocks.archiveTemplate).not.toHaveBeenCalled()
  })

  it('renvoie le refus uniforme si la Mission du template est introuvable', async () => {
    mocks.getMission.mockResolvedValue(null)

    const result = await archiveRecurrenceAction({ templateId })

    expect(result).toEqual({ ok: false, error: REFUS })
    expect(mocks.requireSiteWriteAccess).not.toHaveBeenCalled()
    expect(mocks.archiveTemplate).not.toHaveBeenCalled()
  })

  it('users.role=manager + membershipRole=manager sur le site de la Mission du template → autorisé', async () => {
    mocks.requireSiteWriteAccess.mockResolvedValue({ ok: true, organizationId: orgId, userId, role: 'admin' })

    const result = await archiveRecurrenceAction({ templateId })

    expect(result).toEqual({ ok: true })
    expect(mocks.archiveTemplate).toHaveBeenCalledTimes(1)
  })

  it('users.role=manager + membershipRole insuffisant sur le site de la Mission du template → refus uniforme (fail-closed)', async () => {
    mocks.requireSiteWriteAccess.mockResolvedValue({ ok: false, error: REFUS })

    const result = await archiveRecurrenceAction({ templateId })

    expect(result).toEqual({ ok: false, error: REFUS })
    expect(mocks.archiveTemplate).not.toHaveBeenCalled()
  })

  it('membership absente sur l’organisation du site → refus uniforme', async () => {
    mocks.requireSiteWriteAccess.mockResolvedValue({ ok: false, error: REFUS })

    const result = await archiveRecurrenceAction({ templateId })

    expect(result).toEqual({ ok: false, error: REFUS })
    expect(mocks.archiveTemplate).not.toHaveBeenCalled()
  })

  it('template dont la Mission appartient à un autre tenant → refus uniforme', async () => {
    mocks.requireSiteWriteAccess.mockResolvedValue({ ok: false, error: REFUS })

    const result = await archiveRecurrenceAction({ templateId })

    expect(result).toEqual({ ok: false, error: REFUS })
    expect(mocks.archiveTemplate).not.toHaveBeenCalled()
  })
})
