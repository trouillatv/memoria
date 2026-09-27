// PLAN-INTEG-1 FINAL — review ChatGPT du SHA 9eda7fdc (FIX_REQUIRED, mandat
// Vincent 2026-09-27).
//
// Bug #1 (frontière M2C) : requireManagerOrAdmin() lit users.role (profil
// global) et requireOwned() ne vérifie que l'appartenance — jamais le rôle DANS
// l'organisation RÉELLE du chantier. Un compte manager/admin au niveau
// plateforme mais insuffisant sur l'organisation propriétaire du roulement
// ciblé passait quand même. requireSiteWriteAccess(siteId, 'managerOrAdmin')
// résout l'organisation ET le rôle dans cette même organisation — et le site
// vient TOUJOURS de la ressource persistée (getCycle), jamais du siteId client
// pour un roulement existant.
//
// Bug #2 (non-atomicité) : shouldPublishViaRpc excluait tout roulement DÉJÀ
// publié qui le restait (réécriture sur place ou version-split via
// supersedeCycle) — ces écritures contournaient entièrement la RPC exclusive
// fn_plan_publish_cycle_exclusive, au profit de plusieurs appels Supabase-JS
// séparés, non transactionnels. Toute sauvegarde qui ABOUTIT à 'published'
// passe désormais par la RPC, quel que soit le statut de départ.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireSiteWriteAccess: vi.fn(),
  requireManagerOrAdmin: vi.fn(),
  requireOwned: vi.fn(),
  requireTeamCompatibleWithOrg: vi.fn(),
  getMission: vi.fn(),
  findOrCreateMissionByName: vi.fn(),
  getCycle: vi.fn(),
  createCycle: vi.fn(),
  updateCycle: vi.fn(),
  supersedeCycle: vi.fn(),
  savePublishedCycleAtomic: vi.fn(),
  supersedeCyclePublishedAtomic: vi.fn(),
  softDeleteCycle: vi.fn(),
  resolveEffectiveDate: vi.fn(),
  isRealSplit: vi.fn(),
  todayLocalIso: vi.fn(),
  listActiveClosuresForSites: vi.fn(),
  previewCycle: vi.fn(),
  logAuditEvent: vi.fn(),
  revalidatePath: vi.fn(),
  rpc: vi.fn(),
}))

function makeConflictFreeBuilder() {
  const builder: Record<string, unknown> = {}
  const chain = ['select', 'eq', 'is', 'lte', 'or', 'limit']
  for (const m of chain) builder[m] = vi.fn(() => builder)
  ;(builder as { then: (resolve: (v: unknown) => unknown) => unknown }).then = (resolve) =>
    resolve({ data: [], error: null })
  return builder
}

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/lib/auth/require', () => ({ requireManagerOrAdmin: mocks.requireManagerOrAdmin }))
vi.mock('@/lib/auth/ownership', () => ({ requireOwned: mocks.requireOwned }))
vi.mock('@/lib/auth/site-write-access', () => ({ requireSiteWriteAccess: mocks.requireSiteWriteAccess }))
vi.mock('@/lib/auth/team-compatibility', () => ({ requireTeamCompatibleWithOrg: mocks.requireTeamCompatibleWithOrg }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: () => makeConflictFreeBuilder(), rpc: mocks.rpc }),
}))
vi.mock('@/lib/db/missions', () => ({
  findOrCreateMissionByName: mocks.findOrCreateMissionByName,
  getMission: mocks.getMission,
}))
vi.mock('@/lib/db/planning-cycles', () => ({
  createCycle: mocks.createCycle,
  updateCycle: mocks.updateCycle,
  supersedeCycle: mocks.supersedeCycle,
  savePublishedCycleAtomic: mocks.savePublishedCycleAtomic,
  supersedeCyclePublishedAtomic: mocks.supersedeCyclePublishedAtomic,
  softDeleteCycle: mocks.softDeleteCycle,
  getCycle: mocks.getCycle,
}))
vi.mock('@/lib/planning/cycle-effect', () => ({
  resolveEffectiveDate: mocks.resolveEffectiveDate,
  isRealSplit: mocks.isRealSplit,
}))
vi.mock('@/lib/time/local-date', () => ({ todayLocalIso: mocks.todayLocalIso }))
vi.mock('@/lib/db/site-closures', () => ({ listActiveClosuresForSites: mocks.listActiveClosuresForSites }))
vi.mock('@/lib/planning/cycle-preview', () => ({ previewCycle: mocks.previewCycle }))
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: mocks.logAuditEvent }))

import { saveCycleAction, removeCycleAction } from '@/app/(dashboard)/sites/[id]/roulements/actions'

const userId = '22222222-2222-4222-8222-222222222222'
const orgId = '99999999-9999-4999-8999-999999999999'
const siteId = '11111111-1111-4111-8111-111111111111'
const foreignSiteId = '55555555-5555-4555-8555-555555555555'
const missionId = '88888888-8888-4888-8888-888888888888'
const cycleId = '33333333-3333-4333-8333-333333333333'
const newCycleId = '66666666-6666-4666-8666-666666666666'
const teamId = '44444444-4444-4444-8444-444444444444'

const REFUS = 'Accès refusé'

function makeSlot(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    weekIndex: 0,
    weekday: 1,
    teamId,
    state: 'work' as const,
    startTime: '08:00',
    endTime: '12:00',
    ...overrides,
  }
}

function makeInput(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    siteId,
    missionId,
    name: 'Roulement magasin',
    cycleLengthWeeks: 1,
    anchorDate: '2026-01-05',
    startsOn: '2026-01-05',
    endsOn: null,
    slots: [makeSlot()],
    status: 'published' as const,
    confirmReplaceRhythm: true,
    ...overrides,
  }
}

function makeExistingCycle(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: cycleId,
    siteId,
    missionId,
    name: 'Roulement magasin',
    cycleLengthWeeks: 1,
    anchorDate: '2026-01-05',
    startsOn: '2026-01-05',
    endsOn: null,
    status: 'published' as const,
    supersedesCycleId: null,
    slots: [makeSlot()],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireSiteWriteAccess.mockResolvedValue({ ok: true, organizationId: orgId, userId, role: 'manager' })
  mocks.requireTeamCompatibleWithOrg.mockResolvedValue({ allowed: true })
  mocks.getMission.mockResolvedValue({ id: missionId, site_id: siteId, name: 'Nettoyage magasin' })
  mocks.getCycle.mockResolvedValue(null)
  mocks.createCycle.mockResolvedValue(cycleId)
  mocks.updateCycle.mockResolvedValue(undefined)
  mocks.supersedeCycle.mockResolvedValue(cycleId)
  mocks.savePublishedCycleAtomic.mockResolvedValue({ ok: true })
  mocks.supersedeCyclePublishedAtomic.mockResolvedValue({ ok: true, cycleId: newCycleId })
  mocks.softDeleteCycle.mockResolvedValue(undefined)
  mocks.resolveEffectiveDate.mockReturnValue({ date: null })
  mocks.isRealSplit.mockReturnValue(false)
  mocks.todayLocalIso.mockReturnValue('2026-09-27')
  mocks.rpc.mockResolvedValue({ error: null })
})

describe('saveCycleAction — frontière M2C via requireSiteWriteAccess (PLAN-INTEG-1 Bug #1)', () => {
  it('création — résout requireSiteWriteAccess avec le siteId client (aucune ressource existante à interroger)', async () => {
    await saveCycleAction(makeInput())

    expect(mocks.getCycle).not.toHaveBeenCalled()
    expect(mocks.requireSiteWriteAccess).toHaveBeenCalledWith(siteId, 'managerOrAdmin')
  })

  it('édition — charge le roulement RÉEL puis résout requireSiteWriteAccess avec SON site, jamais le siteId client', async () => {
    mocks.getCycle.mockResolvedValue(makeExistingCycle())

    await saveCycleAction(makeInput({ cycleId, siteId: foreignSiteId }))

    expect(mocks.getCycle).toHaveBeenCalledWith(cycleId)
    expect(mocks.requireSiteWriteAccess).toHaveBeenCalledWith(siteId, 'managerOrAdmin')
    expect(mocks.requireSiteWriteAccess).not.toHaveBeenCalledWith(foreignSiteId, expect.anything())
  })

  it('roulement introuvable — refus uniforme, requireSiteWriteAccess jamais appelé (aucun oracle)', async () => {
    mocks.getCycle.mockResolvedValue(null)

    const result = await saveCycleAction(makeInput({ cycleId }))

    expect(result).toEqual({ error: REFUS })
    expect(mocks.requireSiteWriteAccess).not.toHaveBeenCalled()
    expect(mocks.updateCycle).not.toHaveBeenCalled()
  })

  it('users.role=manager/admin mais rôle insuffisant DANS l’organisation réelle du chantier → refus (fail-closed)', async () => {
    mocks.getCycle.mockResolvedValue(makeExistingCycle())
    mocks.requireSiteWriteAccess.mockResolvedValue({ ok: false, error: REFUS })

    const result = await saveCycleAction(makeInput({ cycleId }))

    expect(result).toEqual({ error: REFUS })
    expect(mocks.updateCycle).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('mission choisie appartenant à un autre chantier → refus uniforme', async () => {
    mocks.getMission.mockResolvedValue({ id: missionId, site_id: foreignSiteId, name: 'Autre' })

    const result = await saveCycleAction(makeInput())

    expect(result).toEqual({ error: REFUS })
    expect(mocks.createCycle).not.toHaveBeenCalled()
  })
})

describe('removeCycleAction — frontière M2C via requireSiteWriteAccess (PLAN-INTEG-1 Bug #1)', () => {
  it('charge le roulement RÉEL puis résout requireSiteWriteAccess avec son site', async () => {
    mocks.getCycle.mockResolvedValue(makeExistingCycle())

    await removeCycleAction(cycleId)

    expect(mocks.getCycle).toHaveBeenCalledWith(cycleId)
    expect(mocks.requireSiteWriteAccess).toHaveBeenCalledWith(siteId, 'managerOrAdmin')
  })

  it('roulement introuvable → refus uniforme, requireSiteWriteAccess jamais appelé', async () => {
    mocks.getCycle.mockResolvedValue(null)

    const result = await removeCycleAction(cycleId)

    expect(result).toEqual({ error: REFUS })
    expect(mocks.requireSiteWriteAccess).not.toHaveBeenCalled()
    expect(mocks.softDeleteCycle).not.toHaveBeenCalled()
  })

  it('rôle insuffisant dans l’organisation réelle → refus, softDeleteCycle jamais appelé', async () => {
    mocks.getCycle.mockResolvedValue(makeExistingCycle())
    mocks.requireSiteWriteAccess.mockResolvedValue({ ok: false, error: REFUS })

    const result = await removeCycleAction(cycleId)

    expect(result).toEqual({ error: REFUS })
    expect(mocks.softDeleteCycle).not.toHaveBeenCalled()
  })
})

describe('saveCycleAction — toute écriture publiée passe par la RPC exclusive (PLAN-INTEG-1 Bug #2)', () => {
  it('brouillon → publié (création) : passe déjà par la RPC — non-régression', async () => {
    await saveCycleAction(makeInput({ status: 'published' }))

    expect(mocks.createCycle).toHaveBeenCalledWith(expect.objectContaining({ status: 'draft' }))
    expect(mocks.rpc).toHaveBeenCalledWith(
      'fn_plan_publish_cycle_exclusive',
      expect.objectContaining({ p_cycle_id: cycleId, p_actor_id: userId }),
    )
  })

  it('brouillon → brouillon : ne déclenche jamais la RPC de publication', async () => {
    await saveCycleAction(makeInput({ status: 'draft' }))

    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('roulement déjà publié réécrit sur place, reste publié → passe par la RPC atomique unique fn_plan_save_published_cycle_exclusive (mig 444), jamais updateCycle/supersedeCycle/rpc en plusieurs appels', async () => {
    mocks.getCycle.mockResolvedValue(makeExistingCycle({ status: 'published' }))
    mocks.resolveEffectiveDate.mockReturnValue({ date: null }) // effect='rewrite' : pas de split
    mocks.savePublishedCycleAtomic.mockResolvedValue({ ok: true })

    const result = await saveCycleAction(makeInput({ cycleId, effect: 'rewrite', status: 'published' }))

    expect(mocks.savePublishedCycleAtomic).toHaveBeenCalledWith({
      cycleId,
      payload: expect.objectContaining({ missionId, siteId, status: 'published' }),
      confirmReplaceSimple: true,
      actorId: userId,
    })
    expect(mocks.updateCycle).not.toHaveBeenCalled()
    expect(mocks.supersedeCycle).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: true, cycleId })
  })

  it('roulement déjà publié découpé en nouvelle version, reste publié → passe par la RPC atomique unique fn_plan_supersede_cycle_exclusive (mig 444), jamais supersedeCycle/updateCycle/rpc en plusieurs appels', async () => {
    mocks.getCycle.mockResolvedValue(makeExistingCycle({ status: 'published' }))
    mocks.resolveEffectiveDate.mockReturnValue({ date: '2026-10-01' })
    mocks.isRealSplit.mockReturnValue(true)
    mocks.supersedeCyclePublishedAtomic.mockResolvedValue({ ok: true, cycleId: newCycleId })

    const result = await saveCycleAction(makeInput({ cycleId, effect: 'date', effectDate: '2026-10-01', status: 'published' }))

    expect(mocks.supersedeCyclePublishedAtomic).toHaveBeenCalledWith({
      oldCycleId: cycleId,
      effectiveFrom: '2026-10-01',
      payload: expect.objectContaining({ missionId, siteId, status: 'published' }),
      confirmReplaceSimple: true,
      actorId: userId,
    })
    expect(mocks.supersedeCycle).not.toHaveBeenCalled()
    expect(mocks.updateCycle).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: true, cycleId: newCycleId })
  })

  it('roulement déjà publié qui redevient brouillon : ne passe pas par la RPC de publication', async () => {
    mocks.getCycle.mockResolvedValue(makeExistingCycle({ status: 'published' }))

    await saveCycleAction(makeInput({ cycleId, effect: 'rewrite', status: 'draft' }))

    expect(mocks.updateCycle).toHaveBeenCalledWith(cycleId, expect.objectContaining({ status: 'draft' }))
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('la RPC atomique signale un rythme simple concurrent → conflit renvoyé, jamais un succès silencieux', async () => {
    mocks.getCycle.mockResolvedValue(makeExistingCycle({ status: 'published' }))
    mocks.savePublishedCycleAtomic.mockResolvedValue({
      error: 'Cette mission utilise déjà un rythme simple. Confirmez le remplacement pour publier ce roulement.',
      conflict: 'replace_simple_with_cycle',
    })

    const result = await saveCycleAction(makeInput({ cycleId, effect: 'rewrite', status: 'published' }))

    expect(result).toEqual({
      error: 'Cette mission utilise déjà un rythme simple. Confirmez le remplacement pour publier ce roulement.',
      conflict: 'replace_simple_with_cycle',
    })
  })
})
