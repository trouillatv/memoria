// P0-3.1A (mandat Vincent 2026-09-25) — server action mutualisée desktop/mobile.
// Preuves : validation zod, requireSiteWriteAccess gating (accès refusé bloque
// toute écriture), revalidatePath desktop ET mobile, propagation du userId
// authentifié comme created_by (jamais un champ client).

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireSiteWriteAccess: vi.fn(),
  createSiteEngagementManual: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/lib/auth/site-write-access', () => ({ requireSiteWriteAccess: mocks.requireSiteWriteAccess }))
vi.mock('@/lib/db/engagements', () => ({ createSiteEngagementManual: mocks.createSiteEngagementManual }))

import { createPlannedEngagementManualAction } from '@/app/(dashboard)/sites/[id]/prestations/actions'

const siteId = '11111111-1111-4111-8111-111111111111'

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    site_id: siteId,
    short_label: 'Nettoyage hebdomadaire des vitres',
    source_excerpt: null,
    category: 'frequency' as const,
    kind: null,
    measurable: false,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireSiteWriteAccess.mockResolvedValue({ ok: true, organizationId: 'org-1', userId: 'user-1', role: 'admin' })
  mocks.createSiteEngagementManual.mockResolvedValue({ id: 'eng-99' })
})

describe('createPlannedEngagementManualAction', () => {
  it('paramètres invalides (libellé vide) : refuse sans appeler requireSiteWriteAccess', async () => {
    const result = await createPlannedEngagementManualAction(validInput({ short_label: '' }))

    expect(result).toEqual({ ok: false, error: 'Paramètres invalides' })
    expect(mocks.requireSiteWriteAccess).not.toHaveBeenCalled()
    expect(mocks.createSiteEngagementManual).not.toHaveBeenCalled()
  })

  it('accès refusé (hors organisation / rôle insuffisant) : aucune écriture', async () => {
    mocks.requireSiteWriteAccess.mockResolvedValue({ ok: false, error: 'Accès refusé' })

    const result = await createPlannedEngagementManualAction(validInput())

    expect(result).toEqual({ ok: false, error: 'Accès refusé' })
    expect(mocks.createSiteEngagementManual).not.toHaveBeenCalled()
  })

  it('succès : passe le userId authentifié comme created_by, jamais un champ du client', async () => {
    await createPlannedEngagementManualAction(validInput())

    expect(mocks.createSiteEngagementManual).toHaveBeenCalledWith(
      expect.objectContaining({ site_id: siteId, created_by: 'user-1' }),
    )
  })

  it('succès : revalide la page desktop ET la page mobile', async () => {
    await createPlannedEngagementManualAction(validInput())

    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/sites/${siteId}/prestations`)
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/m/site/${siteId}/prestations`)
  })

  it('succès : rend { ok: true, id }', async () => {
    const result = await createPlannedEngagementManualAction(validInput())
    expect(result).toEqual({ ok: true, id: 'eng-99' })
  })

  it('échec de la création (exception DB) : rend un message générique, ne fuit pas l’erreur brute', async () => {
    mocks.createSiteEngagementManual.mockRejectedValue(new Error('database unavailable'))

    const result = await createPlannedEngagementManualAction(validInput())

    expect(result).toEqual({ ok: false, error: 'Échec de la création' })
  })
})
