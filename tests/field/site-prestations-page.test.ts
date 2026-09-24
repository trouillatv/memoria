// Revue ChatGPT 2026-09-25 sur P0-3 : prouver (a) l'état vide avec le nouveau
// libellé métier, (b) le rendu conditionnel du badge « Mesurable », et (c) que
// requireSiteAccess est bien appelé AVANT listPlannedEngagementsForSite (un
// chantier d'une autre organisation doit rester indiscernable d'un chantier
// inexistant). Même pattern que tests/knowledge/field-actions-page-scope.test.ts :
// on appelle la page directement et on marche l'arbre React renvoyé.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRequireSiteAccess = vi.fn(async (...a: unknown[]) => ({
  siteId: a[0],
  user: { id: 'u1', role: 'admin' },
}))
vi.mock('@/lib/field/site-access', () => ({
  requireSiteAccess: (...a: unknown[]) => mockRequireSiteAccess(...a),
}))

const mockListPlannedEngagements = vi.fn(async (..._a: unknown[]) => [] as unknown[])
vi.mock('@/lib/db/engagements', () => ({
  listPlannedEngagementsForSite: (...a: unknown[]) => mockListPlannedEngagements(...a),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from() {
      const query = {
        select() { return query },
        eq() { return query },
        is() { return query },
        maybeSingle: () => Promise.resolve({ data: { id: 'site-1' }, error: null }),
      }
      return query
    },
  }),
}))

const { default: SitePrestationsMobilePage } = await import(
  '@/app/(field)/m/site/[siteId]/(chantier)/prestations/page'
)

/**
 * Cherche un texte exact dans un arbre React non monté. `SitePrestationsMobilePage`
 * imbrique des composants FONCTION (`PlannedEngagementCard`, `ProvenanceLine`) —
 * React.createElement ne les exécute pas tant qu'on ne rend pas réellement l'arbre,
 * donc on doit les invoquer nous-mêmes ici pour atteindre leur contenu.
 */
function treeContainsText(node: unknown, text: string): boolean {
  if (node == null || typeof node === 'boolean') return false
  if (typeof node === 'string') return node === text
  if (Array.isArray(node)) return node.some((n) => treeContainsText(n, text))
  const el = node as { type?: unknown; props?: { children?: unknown } }
  if (typeof el.type === 'function') {
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
})

describe('/m/site/[siteId]/prestations — état vide et badge Mesurable', () => {
  it('zéro Engagement : affiche le nouveau libellé métier (pas "Aucune prestation validée...")', async () => {
    mockListPlannedEngagements.mockResolvedValueOnce([])
    const tree = await SitePrestationsMobilePage({ params: Promise.resolve({ siteId: 'site-1' }) })

    expect(treeContainsText(tree, 'Aucun engagement contractuel validé pour ce chantier.')).toBe(true)
    expect(treeContainsText(tree, 'Aucune prestation validée sur ce chantier.')).toBe(false)
  })

  it('measurable=true : rend le badge « Mesurable »', async () => {
    mockListPlannedEngagements.mockResolvedValueOnce([plannedEngagement({ measurable: true })])
    const tree = await SitePrestationsMobilePage({ params: Promise.resolve({ siteId: 'site-1' }) })

    expect(treeContainsText(tree, 'Mesurable')).toBe(true)
  })

  it('measurable=false : ne rend PAS de badge « Mesurable » (ni aucun texte "Non mesurable")', async () => {
    mockListPlannedEngagements.mockResolvedValueOnce([plannedEngagement({ measurable: false })])
    const tree = await SitePrestationsMobilePage({ params: Promise.resolve({ siteId: 'site-1' }) })

    expect(treeContainsText(tree, 'Mesurable')).toBe(false)
    expect(treeContainsText(tree, 'Non mesurable')).toBe(false)
  })

  it('sécurité : requireSiteAccess est appelé AVANT listPlannedEngagementsForSite', async () => {
    mockListPlannedEngagements.mockResolvedValueOnce([])
    await SitePrestationsMobilePage({ params: Promise.resolve({ siteId: 'site-1' }) })

    expect(mockRequireSiteAccess).toHaveBeenCalledWith('site-1')
    expect(mockListPlannedEngagements).toHaveBeenCalledWith('site-1')
    const accessOrder = mockRequireSiteAccess.mock.invocationCallOrder[0]
    const listOrder = mockListPlannedEngagements.mock.invocationCallOrder[0]
    expect(accessOrder).toBeLessThan(listOrder)
  })
})
