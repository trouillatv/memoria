// LE PLANNING EST UN ESPACE, PAS TROIS PAGES.
//
// Ce qu'on protège :
//   • le mois, la semaine et le jour sont trois ÉCHELLES du même planning —
//     l'en-tête vit dans la mise en page du groupe, donc il survit au
//     changement d'échelle : on zoome, on ne navigue pas ;
//   • le planning habituel n'est PAS une échelle : il fabrique le planning. Le
//     voir réapparaître dans la barre voudrait dire qu'on a re-transformé un
//     réglage en destination — l'erreur que ce lot corrige.

import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PlanningSpaceHeader } from '@/components/planning/PlanningSpaceHeader'
import { NAV } from '@/components/layout/nav-items'

const pathname = vi.hoisted(() => ({ current: '/mois' }))
const search = vi.hoisted(() => ({ current: new URLSearchParams() }))
vi.mock('next/navigation', () => ({
  usePathname: () => pathname.current,
  useSearchParams: () => search.current,
}))

beforeEach(() => {
  pathname.current = '/mois'
  search.current = new URLSearchParams()
})

describe("L'espace Planning — trois échelles, un seul écran", () => {
  it('offre le mois, la semaine et le jour — et rien d’autre comme échelle', () => {
    pathname.current = '/mois'
    render(<PlanningSpaceHeader />)

    const scales = screen.getByRole('navigation', { name: 'Échelle de temps' })
    expect(within(scales).getByRole('link', { name: 'Mois' })).toHaveAttribute('href', '/mois')
    expect(within(scales).getByRole('link', { name: 'Semaine' })).toHaveAttribute('href', '/semaine')
    expect(within(scales).getByRole('link', { name: 'Jour' })).toHaveAttribute('href', '/aujourdhui')
    expect(within(scales).getAllByRole('link')).toHaveLength(3)

    // Ce qui fabrique le planning n'est pas une façon de le lire.
    expect(within(scales).queryByRole('link', { name: /habituel|Roulement/i })).not.toBeInTheDocument()
  })

  it('dit où l’on se trouve, sans quitter l’espace', () => {
    pathname.current = '/semaine'
    render(<PlanningSpaceHeader />)

    expect(screen.getByRole('link', { name: 'Semaine' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Mois' })).not.toHaveAttribute('aria-current')
    // Le titre de l'espace ne change pas d'une échelle à l'autre.
    expect(screen.getByRole('heading', { name: 'Planning' })).toBeInTheDocument()
  })

  it('range les réglages derrière l’engrenage, là où l’on va rarement', () => {
    pathname.current = '/mois'
    render(<PlanningSpaceHeader />)

    expect(screen.getByRole('button', { name: 'Configurer' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Planning habituel/ })).toHaveAttribute('href', '/roulements')
    expect(screen.getByRole('link', { name: /Jours fermés/ })).toHaveAttribute('href', '/calendrier')
  })
})

describe('Le menu — le planning est un espace, le roulement un réglage', () => {
  it('ouvre le domaine sur le mois', () => {
    expect(NAV.find((i) => i.groupStart === 'Planning')?.href).toBe('/mois')
  })

  it('range les trois échelles ensemble, dans l’ordre de lecture', () => {
    const scales = NAV.filter((i) => ['/mois', '/semaine', '/aujourdhui'].includes(i.href))
    expect(scales.map((i) => i.label)).toEqual(['Mois', 'Semaine', 'Jour'])
  })

  it('ne présente plus le roulement comme une destination du planning', () => {
    const roulements = NAV.find((i) => i.href === '/roulements')
    // Le moteur reste ; le mot de développeur disparaît de l'écran.
    expect(roulements?.label).toBe('Planning habituel')
    expect(roulements?.groupStart).toBe('Régler le planning')
  })
})

// R3 — la CONTINUITÉ : changer d'échelle est un zoom, pas un retour à zéro.
// L'en-tête lit la période dans l'URL et retombe sur la MÊME période à l'échelle
// voisine, en conservant le mode de lecture. Sans param, les liens sont neutres.
describe("R3 — changer d'échelle conserve la période et le mode", () => {
  it('depuis le Mois : Semaine et Jour retombent sur juillet, mode conservé', () => {
    pathname.current = '/mois'
    search.current = new URLSearchParams('m=2026-07&view=team')
    render(<PlanningSpaceHeader />)
    const scales = screen.getByRole('navigation', { name: 'Échelle de temps' })
    expect(within(scales).getByRole('link', { name: 'Mois' })).toHaveAttribute('href', '/mois?m=2026-07&view=team')
    expect(within(scales).getByRole('link', { name: 'Semaine' }).getAttribute('href')).toMatch(
      /^\/semaine\?week=2026-W\d{2}&view=team$/,
    )
    // Le Jour n'a pas d'axe équipe : la date suit (milieu du mois), le mode non.
    expect(within(scales).getByRole('link', { name: 'Jour' })).toHaveAttribute('href', '/aujourdhui?date=2026-07-15')
  })

  it('depuis le Jour : Semaine et Mois gardent la date affichée', () => {
    pathname.current = '/aujourdhui'
    search.current = new URLSearchParams('date=2026-07-15')
    render(<PlanningSpaceHeader />)
    const scales = screen.getByRole('navigation', { name: 'Échelle de temps' })
    expect(within(scales).getByRole('link', { name: 'Mois' })).toHaveAttribute('href', '/mois?m=2026-07')
    expect(within(scales).getByRole('link', { name: 'Semaine' }).getAttribute('href')).toMatch(
      /^\/semaine\?week=2026-W\d{2}$/,
    )
    expect(within(scales).getByRole('link', { name: 'Jour' })).toHaveAttribute('href', '/aujourdhui?date=2026-07-15')
  })

  it('sans période dans l’URL, les liens restent neutres', () => {
    pathname.current = '/mois'
    render(<PlanningSpaceHeader />)
    const scales = screen.getByRole('navigation', { name: 'Échelle de temps' })
    expect(within(scales).getByRole('link', { name: 'Mois' })).toHaveAttribute('href', '/mois')
    expect(within(scales).getByRole('link', { name: 'Semaine' })).toHaveAttribute('href', '/semaine')
    expect(within(scales).getByRole('link', { name: 'Jour' })).toHaveAttribute('href', '/aujourdhui')
  })
})
