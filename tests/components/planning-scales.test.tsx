// LE PLANNING EST UN ESPACE, PAS TROIS PAGES.
//
// Ce qu'on protège :
//   • le mois, la semaine et le jour sont trois ÉCHELLES du même planning —
//     l'en-tête vit dans la mise en page du groupe, donc il survit au
//     changement d'échelle : on zoome, on ne navigue pas ;
//   • le planning habituel n'est PAS une échelle : il fabrique le planning. Le
//     voir réapparaître dans la barre voudrait dire qu'on a re-transformé un
//     réglage en destination — l'erreur que ce lot corrige.

import { fireEvent, render, screen, within } from '@testing-library/react'
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

  it('range les réglages derrière l’engrenage — un PANNEAU, fermé par défaut (R4)', () => {
    pathname.current = '/mois'
    render(<PlanningSpaceHeader />)

    // Fermé par défaut : on y va rarement, on n'y vit pas.
    expect(screen.queryByText('Configuration du planning')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Configurer' }))

    // Les QUATRE réglages — quatre entrées, UN moteur de fermetures.
    expect(screen.getByRole('link', { name: /Roulements/ })).toHaveAttribute('href', '/roulements')
    expect(screen.getByRole('link', { name: /Fermetures du chantier/ })).toHaveAttribute(
      'href',
      '/calendrier#fermetures',
    )
    expect(screen.getByRole('link', { name: /Calendrier scolaire/ })).toHaveAttribute(
      'href',
      '/calendrier#vacances-scolaires',
    )
    expect(screen.getByRole('link', { name: /Jours fériés/ })).toHaveAttribute(
      'href',
      '/calendrier#jours-feries',
    )
    // Le mot de développeur a disparu de l'écran.
    expect(screen.queryByText(/Planning habituel/)).not.toBeInTheDocument()
  })
})

// R4 — LE MENU NE MONTRE PLUS QU'UNE ENTRÉE « Planning ».
// Guillaume ne voit plus un tiroir à cinq poignées : il voit un Planning, il y
// entre par le mois, et il zoome À L'INTÉRIEUR. Ce qui règle le planning vit
// derrière « Configurer » — pas dans la navigation.
describe('Le menu — UNE entrée Planning, rien d’autre (R4)', () => {
  it('offre une seule entrée « Planning », qui ouvre sur le mois', () => {
    const planning = NAV.filter((i) => i.label === 'Planning')
    expect(planning).toHaveLength(1)
    expect(planning[0].href).toBe('/mois')
  })

  it('ne montre plus les échelles ni les réglages comme destinations', () => {
    // Les routes restent vivantes (compatibilité) ; seul le MENU se replie.
    for (const href of ['/semaine', '/aujourdhui', '/roulements', '/calendrier']) {
      expect(NAV.find((i) => i.href === href)).toBeUndefined()
    }
    expect(NAV.find((i) => i.label === 'Planning habituel')).toBeUndefined()
    expect(NAV.find((i) => i.label === 'Jours fermés')).toBeUndefined()
  })

  it('garde le Briefing du soir séparé — un rituel, pas une échelle', () => {
    expect(NAV.find((i) => i.href === '/briefing')?.label).toBe('Briefing du soir')
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
