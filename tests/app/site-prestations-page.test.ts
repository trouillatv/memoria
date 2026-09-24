// P0-3 (réouvert par Vincent 2026-09-25) : miroir desktop de
// /m/site/[siteId]/prestations sur /sites/[id]/prestations. Mêmes preuves que
// tests/field/site-prestations-page.test.ts côté mobile : état vide avec le
// bon libellé métier, badge « Mesurable » conditionnel, ET frontière
// d'organisation — getSiteIdentity (équivalent desktop de requireSiteAccess)
// doit être appelé AVANT listPlannedEngagementsForSite, sinon un chantier
// d'une autre organisation ne serait pas indiscernable d'un chantier
// inexistant.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetCurrentUser = vi.fn(async (..._a: unknown[]) => ({ id: 'u1', role: 'admin' } as unknown))
vi.mock('@/lib/db/users', () => ({
  getCurrentUserWithProfile: (...a: unknown[]) => mockGetCurrentUser(...a),
}))

const mockGetSiteIdentity = vi.fn(async (...a: unknown[]) => ({
  id: a[0],
  name: 'BELLA NAPOLI',
  clientName: 'RUS',
} as unknown))
vi.mock('@/lib/db/site-cockpit', () => ({
  getSiteIdentity: (...a: unknown[]) => mockGetSiteIdentity(...a),
}))

const mockListPlannedEngagements = vi.fn(async (..._a: unknown[]) => [] as unknown[])
vi.mock('@/lib/db/engagements', () => ({
  listPlannedEngagementsForSite: (...a: unknown[]) => mockListPlannedEngagements(...a),
}))

const mockFindPendingEngagementFinalization = vi.fn(async (..._a: unknown[]) => null as unknown)
vi.mock('@/lib/db/materialize-engagement', () => ({
  findPendingEngagementFinalizationForSite: (...a: unknown[]) => mockFindPendingEngagementFinalization(...a),
}))

const { default: SitePrestationsPage } = await import(
  '@/app/(dashboard)/sites/[id]/prestations/page'
)

/**
 * Marche un arbre React non monté, comme tests/field/site-prestations-page.test.ts.
 * `/sites/[id]` ajoute des composants CLIENT à hooks réels (ScrollActiveRail
 * dans SiteChantierNav, DynamicCrumb/BreadcrumbPrefix) : les invoquer comme de
 * simples fonctions hors du rendu React lèverait « Invalid hook call ». On les
 * traite spécialement — DynamicCrumb/BreadcrumbPrefix sont invisibles (skip),
 * ScrollActiveRail est un simple passe-plat de ses enfants (on descend dans
 * ses props.children sans l'invoquer).
 */
const SKIP_COMPONENTS = new Set(['DynamicCrumb', 'BreadcrumbPrefix'])
const UNWRAP_COMPONENTS = new Set(['ScrollActiveRail'])

function treeContainsText(node: unknown, text: string): boolean {
  if (node == null || typeof node === 'boolean') return false
  if (typeof node === 'string') return node === text
  if (Array.isArray(node)) return node.some((n) => treeContainsText(n, text))
  const el = node as { type?: unknown; props?: { children?: unknown } }
  if (typeof el.type === 'function') {
    const name = (el.type as { name?: string }).name
    if (name && SKIP_COMPONENTS.has(name)) return false
    if (name && UNWRAP_COMPONENTS.has(name)) {
      return el.props ? treeContainsText(el.props.children, text) : false
    }
    return treeContainsText((el.type as (props: unknown) => unknown)(el.props), text)
  }
  return el.props ? treeContainsText(el.props.children, text) : false
}

function plannedEngagement(overrides: Record<string, unknown> = {}) {
  return {
    id: 'eng-1',
    shortLabel: 'Nettoyage mensuel des filtres',
    category: 'frequency',
    kind: 'obligation',
    measurable: false,
    status: 'curated',
    createdAt: '2026-09-01T00:00:00Z',
    primaryProvenance: {
      documentId: 'doc-1',
      documentFilename: 'CCTP.pdf',
      pageNumber: 5,
      excerpt: 'Nettoyer les filtres tous les mois',
      frequencyRaw: 'Mensuel',
    },
    additionalProvenance: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetCurrentUser.mockResolvedValue({ id: 'u1', role: 'admin' })
  mockGetSiteIdentity.mockImplementation(async (...a: unknown[]) => ({
    id: a[0],
    name: 'BELLA NAPOLI',
    clientName: 'RUS',
  }))
})

describe('/sites/[id]/prestations — état vide, badge Mesurable, sécurité', () => {
  it('zéro Engagement : même libellé métier que le mobile', async () => {
    mockListPlannedEngagements.mockResolvedValueOnce([])
    const tree = await SitePrestationsPage({ params: Promise.resolve({ id: 'site-1' }) })

    expect(treeContainsText(tree, 'Aucun engagement contractuel validé pour ce chantier.')).toBe(true)
  })

  it('zéro Engagement mais propositions acceptées non finalisées : état vide intelligent avec CTA', async () => {
    mockListPlannedEngagements.mockResolvedValueOnce([])
    mockFindPendingEngagementFinalization.mockResolvedValueOnce({
      runId: 'run-1', documentId: 'doc-1', count: 43,
    })
    const tree = await SitePrestationsPage({ params: Promise.resolve({ id: 'site-1' }) })

    expect(treeContainsText(tree, 'Aucun engagement contractuel validé pour ce chantier.')).toBe(false)
    expect(treeContainsText(tree, 'Finaliser les 43 Engagements')).toBe(true)
  })

  it('measurable=true : rend le badge « Mesurable »', async () => {
    mockListPlannedEngagements.mockResolvedValueOnce([plannedEngagement({ measurable: true })])
    const tree = await SitePrestationsPage({ params: Promise.resolve({ id: 'site-1' }) })

    expect(treeContainsText(tree, 'Mesurable')).toBe(true)
  })

  it('measurable=false : ne rend PAS de badge « Mesurable »', async () => {
    mockListPlannedEngagements.mockResolvedValueOnce([plannedEngagement({ measurable: false })])
    const tree = await SitePrestationsPage({ params: Promise.resolve({ id: 'site-1' }) })

    expect(treeContainsText(tree, 'Mesurable')).toBe(false)
  })

  it('rend le statut, la provenance et la fréquence d’un engagement curated/active', async () => {
    mockListPlannedEngagements.mockResolvedValueOnce([plannedEngagement()])
    const tree = await SitePrestationsPage({ params: Promise.resolve({ id: 'site-1' }) })

    expect(treeContainsText(tree, 'Nettoyage mensuel des filtres')).toBe(true)
    expect(treeContainsText(tree, 'Mensuel')).toBe(true)
  })

  it('sécurité : getSiteIdentity est appelé AVANT listPlannedEngagementsForSite', async () => {
    mockListPlannedEngagements.mockResolvedValueOnce([])
    await SitePrestationsPage({ params: Promise.resolve({ id: 'site-1' }) })

    expect(mockGetSiteIdentity).toHaveBeenCalledWith('site-1')
    expect(mockListPlannedEngagements).toHaveBeenCalledWith('site-1')
    const identityOrder = mockGetSiteIdentity.mock.invocationCallOrder[0]
    const listOrder = mockListPlannedEngagements.mock.invocationCallOrder[0]
    expect(identityOrder).toBeLessThan(listOrder)
  })

  it('chantier d’une autre organisation : getSiteIdentity renvoie null → 404, jamais de lecture des engagements', async () => {
    mockGetSiteIdentity.mockResolvedValueOnce(null as unknown as { id: string; name: string })

    await expect(
      SitePrestationsPage({ params: Promise.resolve({ id: 'site-cross-org' }) }),
    ).rejects.toThrow()

    expect(mockListPlannedEngagements).not.toHaveBeenCalled()
  })
})
