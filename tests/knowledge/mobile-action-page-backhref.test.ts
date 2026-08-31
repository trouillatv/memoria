// Convergence Actions mobile — retour de navigation (GO Vincent, 2026-09-01).
// La fiche /m/site/[siteId]/action/[actionId] fait désormais partie du parcours
// depuis /m/actions?site=X. Sa flèche doit revenir à CETTE liste filtrée quand
// on vient de là, et conserver son retour chantier historique sinon.
// La destination est TOUJOURS reconstruite depuis `siteId` du chemin ; seul le
// jeton whitelisté `from=actions` bascule le retour — jamais un returnTo URL
// arbitraire. Ces tests prouvent cette validation côté serveur.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetCurrentUser = vi.fn()
vi.mock('@/lib/db/users', () => ({
  getCurrentUserWithProfile: (...a: unknown[]) => mockGetCurrentUser(...a),
}))

const mockGetFiche = vi.fn()
vi.mock('@/lib/knowledge/action-fiche', () => ({
  getSiteActionFiche: (...a: unknown[]) => mockGetFiche(...a),
}))

// MobileActionView reste réelle mais n'est jamais rendue : on inspecte les props
// de l'élément React renvoyé par le composant serveur (lazy, non monté).
vi.mock('@/app/(field)/m/site/[siteId]/action/[actionId]/MobileActionView', () => ({
  MobileActionView: () => null,
}))

vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND') } }))

const { default: MobileActionPage } = await import('@/app/(field)/m/site/[siteId]/action/[actionId]/page')

function props(from?: string) {
  return {
    params: Promise.resolve({ siteId: 'site-1', actionId: 'a1' }),
    searchParams: Promise.resolve(from === undefined ? {} : { from }),
  }
}

async function backHrefFor(from?: string): Promise<string> {
  const el = (await MobileActionPage(props(from))) as { props: { backHref: string } }
  return el.props.backHref
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetCurrentUser.mockResolvedValue({ id: 'u1' })
  mockGetFiche.mockResolvedValue({ id: 'a1', siteId: 'site-1', title: 'Action', siteName: 'Chantier A' })
})

describe('MobileActionPage — retour contrôlé (backHref)', () => {
  it('from=actions : la flèche revient à la liste filtrée /m/actions?site=<siteId>', async () => {
    expect(await backHrefFor('actions')).toBe('/m/actions?site=site-1')
  })

  it('sans jeton : fallback historique = accueil chantier /m/site/<siteId>', async () => {
    expect(await backHrefFor(undefined)).toBe('/m/site/site-1')
  })

  it('jeton non reconnu : ignoré, retombe sur le fallback chantier (pas de returnTo arbitraire)', async () => {
    expect(await backHrefFor('actions-globales')).toBe('/m/site/site-1')
  })

  it('tentative d’injection d’URL via le jeton : ignorée, jamais utilisée comme destination', async () => {
    const backHref = await backHrefFor('https://evil.example/steal')
    expect(backHref).toBe('/m/site/site-1')
    expect(backHref).not.toContain('evil.example')
  })
})
