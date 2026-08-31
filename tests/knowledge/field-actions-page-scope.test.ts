// Convergence Actions mobile — GO Vincent (audit navigation/gestion terrain,
// 2026-08-31). `/m/actions` devient le chemin PRINCIPAL de navigation depuis un
// chantier (`?site=<id>`), remplaçant l'ancienne route dédiée. `listOpenSiteActions`
// documente explicitement (M3-D) qu'elle FAIT CONFIANCE à l'appelant pour avoir
// vérifié l'accès au chantier passé en `siteIds` — sans garde en amont,
// `?site=<id d'un autre chantier>` fuiterait des actions hors-org. Ces tests
// prouvent le garde (`requireSiteAccess`) et l'absence de fuite entre les deux
// populations (propositions + actions).

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRequireSiteAccess = vi.fn()
vi.mock('@/lib/field/site-access', () => ({
  requireSiteAccess: (...a: unknown[]) => mockRequireSiteAccess(...a),
}))

const mockGetCurrentUser = vi.fn()
vi.mock('@/lib/db/users', () => ({
  getCurrentUserWithProfile: (...a: unknown[]) => mockGetCurrentUser(...a),
}))

const mockListOpenSiteActions = vi.fn<(...a: unknown[]) => Promise<unknown[]>>(() => Promise.resolve([]))
vi.mock('@/lib/db/site-actions', () => ({
  listOpenSiteActions: (...a: unknown[]) => mockListOpenSiteActions(...a),
}))

const mockGetPendingWork = vi.fn<(...a: unknown[]) => Promise<{ actions: unknown[]; deadlines: unknown[] }>>(() => Promise.resolve({ actions: [], deadlines: [] }))
vi.mock('@/lib/knowledge/pending-work', () => ({
  getPendingWork: (...a: unknown[]) => mockGetPendingWork(...a),
}))

const mockMaybeSingle = vi.fn(async () => ({ data: { name: 'Chantier A' } }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mockMaybeSingle }) }) }),
  }),
}))

vi.mock('@/components/actions/FieldActionsList', () => ({ FieldActionsList: () => null }))
vi.mock('@/app/(field)/m/actions/PendingWorkBlock', () => ({ PendingWorkBlock: () => null }))

const { default: FieldActionsPage } = await import('@/app/(field)/m/actions/page')

beforeEach(() => {
  vi.clearAllMocks()
  mockListOpenSiteActions.mockResolvedValue([])
  mockGetPendingWork.mockResolvedValue({ actions: [], deadlines: [] })
  mockMaybeSingle.mockResolvedValue({ data: { name: 'Chantier A' } })
})

describe('/m/actions — frontière d’accès au scope chantier', () => {
  it('scope chantier : vérifie l’accès AVANT de lire les actions ou les propositions', async () => {
    mockRequireSiteAccess.mockResolvedValue({ siteId: 'site-1', user: { id: 'u1' } })
    await FieldActionsPage({ searchParams: Promise.resolve({ site: 'site-1' }) })

    expect(mockRequireSiteAccess).toHaveBeenCalledWith('site-1')
    expect(mockListOpenSiteActions).toHaveBeenCalledWith({ siteIds: ['site-1'] })
    expect(mockGetPendingWork).toHaveBeenCalledWith({ siteIds: ['site-1'] })
  })

  it('si l’accès au chantier est refusé, aucune action ni proposition n’est lue (pas de fuite)', async () => {
    mockRequireSiteAccess.mockRejectedValue(new Error('NEXT_NOT_FOUND'))
    await expect(FieldActionsPage({ searchParams: Promise.resolve({ site: 'site-etranger' }) })).rejects.toThrow()

    expect(mockRequireSiteAccess).toHaveBeenCalledWith('site-etranger')
    expect(mockListOpenSiteActions).not.toHaveBeenCalled()
    expect(mockGetPendingWork).not.toHaveBeenCalled()
  })

  it('vue globale (sans ?site) : ne vérifie pas d’accès chantier, lit tout le périmètre organisation', async () => {
    mockGetCurrentUser.mockResolvedValue({ id: 'u1' })
    await FieldActionsPage({ searchParams: Promise.resolve({}) })

    expect(mockRequireSiteAccess).not.toHaveBeenCalled()
    expect(mockListOpenSiteActions).toHaveBeenCalledWith(undefined)
    expect(mockGetPendingWork).toHaveBeenCalledWith({})
  })

  it('vue globale sans utilisateur authentifié : ne lit ni actions ni propositions', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const result = await FieldActionsPage({ searchParams: Promise.resolve({}) })

    expect(result).toBeNull()
    expect(mockListOpenSiteActions).not.toHaveBeenCalled()
    expect(mockGetPendingWork).not.toHaveBeenCalled()
  })
})
