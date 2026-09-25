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

// P0-3.2 FIX (revue ChatGPT 2026-09-25) — le gating du CTA « Mettre en
// vigueur » doit venir de requireSiteWriteAccess (rôle DANS l'organisation du
// chantier), jamais de user.role (rôle plateforme, divergent en multi-org).
type SiteWriteAccessResult =
  | { ok: true; organizationId: string; userId: string; role: string }
  | { ok: false; error: string }
const mockRequireSiteWriteAccess = vi.fn(async (..._a: unknown[]): Promise<SiteWriteAccessResult> => ({
  ok: true,
  organizationId: 'org-1',
  userId: 'user-1',
  role: 'manager',
}))
vi.mock('@/lib/auth/site-write-access', () => ({
  requireSiteWriteAccess: (...a: unknown[]) => mockRequireSiteWriteAccess(...a),
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
    // P0-3.1A : le header embarque désormais AddPlannedEngagementDialog, un
    // composant client à hooks (useState/useRouter). L'invoquer comme une
    // fonction pure (hors rendu React) lève "Invalid hook call" — ce n'est
    // pas une régression du composant, juste hors de portée de ce marcheur
    // d'arbre léger. On l'ignore (pas de texte trouvé dedans) plutôt que de
    // faire échouer des assertions qui ne le concernent pas.
    try {
      return treeContainsText((el.type as (props: unknown) => unknown)(el.props), text)
    } catch {
      return false
    }
  }
  return el.props ? treeContainsText(el.props.children, text) : false
}

/**
 * Vérifie la PRÉSENCE d'un composant fonction dans l'arbre par référence de
 * type, sans l'invoquer s'il s'agit du composant recherché (à hooks) — même
 * pattern que tests/components/planned-engagement-card-activate.test.ts.
 */
function treeContainsComponent(node: unknown, componentName: string): boolean {
  if (node == null || typeof node === 'boolean') return false
  if (typeof node === 'string') return false
  if (Array.isArray(node)) return node.some((n) => treeContainsComponent(n, componentName))
  const el = node as { type?: unknown; props?: { children?: unknown } }
  if (typeof el.type === 'function') {
    const name = (el.type as { name?: string }).name
    if (name === componentName) return true
    try {
      return treeContainsComponent((el.type as (props: unknown) => unknown)(el.props), componentName)
    } catch {
      return false
    }
  }
  return el.props ? treeContainsComponent(el.props.children, componentName) : false
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

    expect(treeContainsText(tree, 'Aucun engagement validé pour ce chantier.')).toBe(true)
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

describe('/m/site/[siteId]/prestations — CTA « Mettre en vigueur » (P0-3.2 FIX gating multi-org)', () => {
  it('membership managerOrAdmin sur ce chantier : CTA présent sur un Engagement curated', async () => {
    mockRequireSiteWriteAccess.mockResolvedValueOnce({ ok: true, organizationId: 'org-1', userId: 'user-1', role: 'manager' })
    mockListPlannedEngagements.mockResolvedValueOnce([plannedEngagement({ status: 'curated' })])
    const tree = await SitePrestationsMobilePage({ params: Promise.resolve({ siteId: 'site-1' }) })

    expect(treeContainsComponent(tree, 'ActivateEngagementButton')).toBe(true)
  })

  it('accès refusé (chef_equipe ou autre organisation) : CTA absent même si le profil plateforme est admin', async () => {
    mockRequireSiteAccess.mockResolvedValueOnce({ siteId: 'site-1', user: { id: 'u1', role: 'admin' } })
    mockRequireSiteWriteAccess.mockResolvedValueOnce({ ok: false, error: 'Accès refusé' })
    mockListPlannedEngagements.mockResolvedValueOnce([plannedEngagement({ status: 'curated' })])
    const tree = await SitePrestationsMobilePage({ params: Promise.resolve({ siteId: 'site-1' }) })

    expect(treeContainsComponent(tree, 'ActivateEngagementButton')).toBe(false)
  })

  it('profil plateforme chef_equipe mais membership manager sur ce chantier : CTA présent (le rôle vient de l’organisation, pas du profil)', async () => {
    mockRequireSiteAccess.mockResolvedValueOnce({ siteId: 'site-1', user: { id: 'u1', role: 'chef_equipe' } })
    mockRequireSiteWriteAccess.mockResolvedValueOnce({ ok: true, organizationId: 'org-1', userId: 'user-1', role: 'manager' })
    mockListPlannedEngagements.mockResolvedValueOnce([plannedEngagement({ status: 'curated' })])
    const tree = await SitePrestationsMobilePage({ params: Promise.resolve({ siteId: 'site-1' }) })

    expect(treeContainsComponent(tree, 'ActivateEngagementButton')).toBe(true)
  })

  it('sécurité : requireSiteWriteAccess reçoit le siteId de la route et la politique managerOrAdmin', async () => {
    mockListPlannedEngagements.mockResolvedValueOnce([])
    await SitePrestationsMobilePage({ params: Promise.resolve({ siteId: 'site-1' }) })

    expect(mockRequireSiteWriteAccess).toHaveBeenCalledWith('site-1', 'managerOrAdmin')
  })
})
