// « Traiter un point » (mandat Vincent 2026-09-25) — créer une Action depuis un
// Engagement ACTIF, dans la même transaction SQL que le rapprochement P0-4B
// et la qualification P0-4C (migration 441, FIX_REQUIRED review sur c05469a7).
// Preuves : ordre fail-closed (inexistant → site_id absent → statut ≠ active →
// SEULEMENT ENSUITE requireSiteWriteAccess managerOrAdmin), aucune nouvelle
// taxonomie (4 qualifications P0-4C réutilisées telles quelles), origine
// facultative pliée dans le champ note existant, UN SEUL appel atomique
// (createActionFromEngagementPoint) et AUCUN effet de bord si cet appel
// échoue. La preuve du rollback réel des 3 écritures en base (0 Action / 0
// lien / 0 événement sur échec à n'importe quelle étape interne de la RPC)
// vit dans tests/lib/db/create-action-from-engagement-point-atomic.test.ts
// (test d'intégration, vraie Supabase).

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireSiteWriteAccess: vi.fn(),
  getEngagementAuthContext: vi.fn(),
  createActionFromEngagementPoint: vi.fn(),
  invalidateSiteProjection: vi.fn(),
  resolveSubjectAndAttachCanonicalBusinessObject: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/lib/auth/site-write-access', () => ({ requireSiteWriteAccess: mocks.requireSiteWriteAccess }))
vi.mock('@/lib/db/engagements', () => ({
  createSiteEngagementManual: vi.fn(),
  getEngagementAuthContext: mocks.getEngagementAuthContext,
  activateEngagement: vi.fn(),
}))
vi.mock('@/lib/db/site-action-engagement-links', () => ({
  createActionFromEngagementPoint: mocks.createActionFromEngagementPoint,
}))
vi.mock('@/lib/knowledge/invalidate', () => ({ invalidateSiteProjection: mocks.invalidateSiteProjection }))
vi.mock('@/lib/db/canonical-business-object-attach', () => ({
  resolveSubjectAndAttachCanonicalBusinessObject: mocks.resolveSubjectAndAttachCanonicalBusinessObject,
}))

import { createActionFromEngagementAction } from '@/app/(dashboard)/sites/[id]/prestations/actions'

const engagementId = '22222222-2222-4222-8222-222222222222'
const siteId = '11111111-1111-4111-8111-111111111111'
const actionId = '33333333-3333-4333-8333-333333333333'
const linkId = '44444444-4444-4444-8444-444444444444'

function activeEngagement(overrides: Record<string, unknown> = {}) {
  return { id: engagementId, site_id: siteId, tender_id: null, status: 'active', ...overrides }
}

const validInput = {
  engagement_id: engagementId,
  qualification: 'demande_evolution' as const,
  description: 'Le client souhaite passer à 3 passages/semaine.',
  origin: 'Visite du 23/09',
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getEngagementAuthContext.mockResolvedValue(activeEngagement())
  mocks.requireSiteWriteAccess.mockResolvedValue({ ok: true, organizationId: 'org-1', userId: 'user-1', role: 'manager' })
  mocks.createActionFromEngagementPoint.mockResolvedValue({ ok: true, actionId, linkId })
})

describe('createActionFromEngagementAction', () => {
  it('paramètres invalides (description vide) : refuse sans lecture ni écriture', async () => {
    const result = await createActionFromEngagementAction({ ...validInput, description: '  ' })

    expect(result.ok).toBe(false)
    expect(mocks.getEngagementAuthContext).not.toHaveBeenCalled()
  })

  it('qualification hors des 4 valeurs P0-4C : refuse (aucune nouvelle taxonomie)', async () => {
    const result = await createActionFromEngagementAction({ ...validInput, qualification: 'conforme' } as never)

    expect(result.ok).toBe(false)
    expect(mocks.createActionFromEngagementPoint).not.toHaveBeenCalled()
  })

  it('Engagement inexistant : refuse, aucune écriture', async () => {
    mocks.getEngagementAuthContext.mockResolvedValueOnce(null)

    const result = await createActionFromEngagementAction(validInput)

    expect(result).toEqual({ ok: false, error: 'Impossible de créer cette Action' })
    expect(mocks.requireSiteWriteAccess).not.toHaveBeenCalled()
    expect(mocks.createActionFromEngagementPoint).not.toHaveBeenCalled()
  })

  it('Engagement sans site_id : refuse avant toute autorisation', async () => {
    mocks.getEngagementAuthContext.mockResolvedValueOnce(activeEngagement({ site_id: null }))

    const result = await createActionFromEngagementAction(validInput)

    expect(result).toEqual({ ok: false, error: 'Impossible de créer cette Action' })
    expect(mocks.requireSiteWriteAccess).not.toHaveBeenCalled()
  })

  it('Engagement non actif (curated) : refuse, jamais d’autorisation ni d’écriture', async () => {
    mocks.getEngagementAuthContext.mockResolvedValueOnce(activeEngagement({ status: 'curated' }))

    const result = await createActionFromEngagementAction(validInput)

    expect(result).toEqual({ ok: false, error: 'Impossible de créer cette Action' })
    expect(mocks.requireSiteWriteAccess).not.toHaveBeenCalled()
    expect(mocks.createActionFromEngagementPoint).not.toHaveBeenCalled()
  })

  it('accès refusé (chef_equipe ou autre organisation) : aucune écriture', async () => {
    mocks.requireSiteWriteAccess.mockResolvedValueOnce({ ok: false, error: 'Accès refusé' })

    const result = await createActionFromEngagementAction(validInput)

    expect(result).toEqual({ ok: false, error: 'Accès refusé' })
    expect(mocks.createActionFromEngagementPoint).not.toHaveBeenCalled()
  })

  it('demande la politique managerOrAdmin, pas operator', async () => {
    await createActionFromEngagementAction(validInput)

    expect(mocks.requireSiteWriteAccess).toHaveBeenCalledWith(siteId, 'managerOrAdmin')
  })

  it('succès : un seul appel atomique (Action + rapprochement + qualification), puis effets non critiques', async () => {
    const result = await createActionFromEngagementAction(validInput)

    expect(result).toEqual({ ok: true, actionId })
    expect(mocks.createActionFromEngagementPoint).toHaveBeenCalledTimes(1)
    expect(mocks.createActionFromEngagementPoint).toHaveBeenCalledWith({
      engagementId,
      siteId,
      organizationId: 'org-1',
      title: validInput.description,
      qualification: 'demande_evolution',
      note: 'Visite du 23/09',
      createdBy: 'user-1',
    })
    expect(mocks.invalidateSiteProjection).toHaveBeenCalledWith(siteId)
    expect(mocks.resolveSubjectAndAttachCanonicalBusinessObject).toHaveBeenCalledWith(expect.objectContaining({
      siteId,
      entityType: 'site_action',
      entityId: actionId,
      label: validInput.description,
    }))
  })

  it('origine facultative absente : note = null, aucune écriture perdue', async () => {
    await createActionFromEngagementAction({ ...validInput, origin: null })

    expect(mocks.createActionFromEngagementPoint).toHaveBeenCalledWith(expect.objectContaining({ note: null }))
  })

  it('échec de la création atomique : propage l’erreur, AUCUN effet de bord (pas d’Action orpheline)', async () => {
    mocks.createActionFromEngagementPoint.mockResolvedValueOnce({ ok: false, error: 'Impossible de créer cette Action' })

    const result = await createActionFromEngagementAction(validInput)

    expect(result).toEqual({ ok: false, error: 'Impossible de créer cette Action' })
    expect(mocks.invalidateSiteProjection).not.toHaveBeenCalled()
    expect(mocks.resolveSubjectAndAttachCanonicalBusinessObject).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it('succès : revalide prestations desktop, mobile, et la liste des Actions du chantier', async () => {
    await createActionFromEngagementAction(validInput)

    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/sites/${siteId}/prestations`)
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/m/site/${siteId}/prestations`)
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/sites/${siteId}/actions`)
  })
})
