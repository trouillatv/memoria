// /m/actions — frontière d'accès au scope chantier. Le moteur Actions (fetch
// scopé) vit dans ActionsEnginePanel ; la PAGE, elle, doit vérifier l'accès AVANT
// de rendre ce moteur, sinon `?site=<id d'un autre chantier>` fuiterait des
// actions hors-org (listOpenSiteActions fait confiance à l'appelant, M3-D).
// Ces tests prouvent : garde avant moteur, scope correct, et vue globale non scopée.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRequireSiteAccess = vi.fn()
vi.mock('@/lib/field/site-access', () => ({
  requireSiteAccess: (...a: unknown[]) => mockRequireSiteAccess(...a),
}))

const mockGetCurrentUser = vi.fn()
vi.mock('@/lib/db/users', () => ({
  getCurrentUserWithProfile: (...a: unknown[]) => mockGetCurrentUser(...a),
}))

const mockGetSiteHeaderName = vi.fn<(...a: unknown[]) => Promise<string>>(() => Promise.resolve('Chantier A'))
vi.mock('@/lib/field/site-header', () => ({
  getSiteHeaderName: (...a: unknown[]) => mockGetSiteHeaderName(...a),
}))

// Le moteur (fetch scopé + rendu) est stubé : on teste la FRONTIÈRE du wrapper,
// pas le moteur lui-même. On inspecte le prop `siteId` que le wrapper lui passe.
vi.mock('@/app/(field)/m/actions/ActionsEnginePanel', () => ({ ActionsEnginePanel: () => null }))

const { default: FieldActionsPage } = await import('@/app/(field)/m/actions/page')
const { ActionsEnginePanel } = await import('@/app/(field)/m/actions/ActionsEnginePanel')

/** Cherche un élément React d'un type donné dans l'arbre renvoyé (non monté). */
function findEl(node: unknown, type: unknown): { props: Record<string, unknown> } | null {
  if (!node || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const n of node) { const f = findEl(n, type); if (f) return f }
    return null
  }
  const el = node as { type?: unknown; props?: { children?: unknown } }
  if (el.type === type) return el as { props: Record<string, unknown> }
  return el.props ? findEl(el.props.children, type) : null
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSiteHeaderName.mockResolvedValue('Chantier A')
})

describe('/m/actions — frontière d’accès au scope chantier', () => {
  it('scope chantier : vérifie l’accès AVANT de rendre le moteur, et le scope au chantier', async () => {
    mockRequireSiteAccess.mockResolvedValue({ siteId: 'site-1', user: { id: 'u1', role: 'admin' } })
    const tree = await FieldActionsPage({ searchParams: Promise.resolve({ site: 'site-1' }) })

    expect(mockRequireSiteAccess).toHaveBeenCalledWith('site-1')
    const panel = findEl(tree, ActionsEnginePanel)
    expect(panel).not.toBeNull()
    expect(panel!.props.siteId).toBe('site-1')
  })

  it('accès refusé : le wrapper lève AVANT de rendre le moteur (aucune fuite)', async () => {
    mockRequireSiteAccess.mockRejectedValue(new Error('NEXT_NOT_FOUND'))
    await expect(
      FieldActionsPage({ searchParams: Promise.resolve({ site: 'site-etranger' }) }),
    ).rejects.toThrow()
    expect(mockRequireSiteAccess).toHaveBeenCalledWith('site-etranger')
  })

  it('vue globale (sans ?site) : pas de garde chantier, moteur NON scopé', async () => {
    mockGetCurrentUser.mockResolvedValue({ id: 'u1' })
    const tree = await FieldActionsPage({ searchParams: Promise.resolve({}) })

    expect(mockRequireSiteAccess).not.toHaveBeenCalled()
    const panel = findEl(tree, ActionsEnginePanel)
    expect(panel).not.toBeNull()
    expect(panel!.props.siteId).toBeUndefined()
  })

  it('vue globale sans utilisateur authentifié : retourne null (rien rendu)', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const result = await FieldActionsPage({ searchParams: Promise.resolve({}) })
    expect(result).toBeNull()
  })
})
