// P0-3.2 (mandat Vincent 2026-09-25) — mettre un Engagement Porte B curated en
// vigueur. Preuves : le site_id d'autorisation est TOUJOURS dérivé du serveur
// (jamais un champ client — le schéma n'accepte même que engagement_id),
// l'ordre fail-closed (inexistant → site_id absent → non Porte B → statut ≠
// curated → SEULEMENT ENSUITE requireSiteWriteAccess('managerOrAdmin')), et
// qu'aucune écriture n'a lieu tant qu'une de ces gardes refuse.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireSiteWriteAccess: vi.fn(),
  getEngagementAuthContext: vi.fn(),
  activateEngagement: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/lib/auth/site-write-access', () => ({ requireSiteWriteAccess: mocks.requireSiteWriteAccess }))
vi.mock('@/lib/db/engagements', () => ({
  createSiteEngagementManual: vi.fn(),
  getEngagementAuthContext: mocks.getEngagementAuthContext,
  activateEngagement: mocks.activateEngagement,
}))

import { activatePlannedEngagementAction } from '@/app/(dashboard)/sites/[id]/prestations/actions'

const engagementId = '22222222-2222-4222-8222-222222222222'
const siteId = '11111111-1111-4111-8111-111111111111'

function curatedPorteB(overrides: Record<string, unknown> = {}) {
  return { id: engagementId, site_id: siteId, tender_id: null, status: 'curated', ...overrides }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getEngagementAuthContext.mockResolvedValue(curatedPorteB())
  mocks.requireSiteWriteAccess.mockResolvedValue({ ok: true, organizationId: 'org-1', userId: 'user-1', role: 'manager' })
  mocks.activateEngagement.mockResolvedValue(undefined)
})

describe('activatePlannedEngagementAction', () => {
  it('paramètres invalides (engagement_id absent/non-uuid) : refuse sans lecture ni écriture', async () => {
    const result = await activatePlannedEngagementAction({ engagement_id: 'pas-un-uuid' } as never)

    expect(result).toEqual({ ok: false, error: 'Paramètres invalides' })
    expect(mocks.getEngagementAuthContext).not.toHaveBeenCalled()
  })

  it('un champ site_id fourni par le client est ignoré : le schéma n’accepte que engagement_id', async () => {
    await activatePlannedEngagementAction({ engagement_id: engagementId, site_id: 'site-attaquant' } as never)

    // La seule source du site_id d'autorisation est l'Engagement chargé côté serveur.
    expect(mocks.requireSiteWriteAccess).toHaveBeenCalledWith(siteId, 'managerOrAdmin')
  })

  it('Engagement inexistant : refuse, aucune écriture, message non révélateur', async () => {
    mocks.getEngagementAuthContext.mockResolvedValueOnce(null)

    const result = await activatePlannedEngagementAction({ engagement_id: engagementId })

    expect(result).toEqual({ ok: false, error: 'Impossible de mettre cet engagement en vigueur' })
    expect(mocks.requireSiteWriteAccess).not.toHaveBeenCalled()
    expect(mocks.activateEngagement).not.toHaveBeenCalled()
  })

  it('Engagement sans site_id : refuse avant tout appel d’autorisation', async () => {
    mocks.getEngagementAuthContext.mockResolvedValueOnce(curatedPorteB({ site_id: null }))

    const result = await activatePlannedEngagementAction({ engagement_id: engagementId })

    expect(result).toEqual({ ok: false, error: 'Impossible de mettre cet engagement en vigueur' })
    expect(mocks.requireSiteWriteAccess).not.toHaveBeenCalled()
    expect(mocks.activateEngagement).not.toHaveBeenCalled()
  })

  it('Engagement Porte A (tender_id renseigné) : refuse, jamais d’appel d’autorisation', async () => {
    mocks.getEngagementAuthContext.mockResolvedValueOnce(curatedPorteB({ tender_id: 'tender-1' }))

    const result = await activatePlannedEngagementAction({ engagement_id: engagementId })

    expect(result).toEqual({ ok: false, error: 'Impossible de mettre cet engagement en vigueur' })
    expect(mocks.requireSiteWriteAccess).not.toHaveBeenCalled()
    expect(mocks.activateEngagement).not.toHaveBeenCalled()
  })

  it('Engagement déjà active : refuse, aucune nouvelle mutation', async () => {
    mocks.getEngagementAuthContext.mockResolvedValueOnce(curatedPorteB({ status: 'active' }))

    const result = await activatePlannedEngagementAction({ engagement_id: engagementId })

    expect(result).toEqual({ ok: false, error: 'Impossible de mettre cet engagement en vigueur' })
    expect(mocks.requireSiteWriteAccess).not.toHaveBeenCalled()
    expect(mocks.activateEngagement).not.toHaveBeenCalled()
  })

  it('accès refusé (chef_equipe ou membership d’une autre organisation) : aucune écriture', async () => {
    mocks.requireSiteWriteAccess.mockResolvedValueOnce({ ok: false, error: 'Accès refusé' })

    const result = await activatePlannedEngagementAction({ engagement_id: engagementId })

    expect(result).toEqual({ ok: false, error: 'Accès refusé' })
    expect(mocks.activateEngagement).not.toHaveBeenCalled()
  })

  it('demande la politique managerOrAdmin, pas operator (chef_equipe exclu)', async () => {
    await activatePlannedEngagementAction({ engagement_id: engagementId })

    expect(mocks.requireSiteWriteAccess).toHaveBeenCalledWith(siteId, 'managerOrAdmin')
  })

  it('manager : autorisé, active l’Engagement dérivé du serveur', async () => {
    const result = await activatePlannedEngagementAction({ engagement_id: engagementId })

    expect(result).toEqual({ ok: true })
    expect(mocks.activateEngagement).toHaveBeenCalledWith(engagementId)
  })

  it('admin : autorisé', async () => {
    mocks.requireSiteWriteAccess.mockResolvedValueOnce({ ok: true, organizationId: 'org-1', userId: 'user-2', role: 'admin' })

    const result = await activatePlannedEngagementAction({ engagement_id: engagementId })

    expect(result).toEqual({ ok: true })
  })

  it('succès : revalide la page desktop ET la page mobile du chantier de l’Engagement', async () => {
    await activatePlannedEngagementAction({ engagement_id: engagementId })

    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/sites/${siteId}/prestations`)
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/m/site/${siteId}/prestations`)
  })

  it('échec de l’activation (exception) : message générique, ne fuit pas l’erreur brute', async () => {
    mocks.activateEngagement.mockRejectedValueOnce(new Error('database unavailable'))

    const result = await activatePlannedEngagementAction({ engagement_id: engagementId })

    expect(result).toEqual({ ok: false, error: 'Échec de la mise en vigueur' })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
})
