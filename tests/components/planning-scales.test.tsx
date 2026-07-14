// UN SEUL PLANNING, TROIS ÉCHELLES.
//
// Ce qu'on protège :
//   • le mois, la semaine et le jour sont trois façons de regarder le MÊME
//     planning — on change d'échelle, jamais d'application ;
//   • le roulement n'est PAS une échelle : il fabrique le planning. Le voir
//     apparaître ici voudrait dire qu'on a re-transformé un réglage en
//     destination — l'erreur que ce lot corrige.

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PlanningScales } from '@/components/planning/PlanningScales'
import { NAV } from '@/components/layout/nav-items'

describe('Les trois échelles du planning', () => {
  it('mène au mois, à la semaine et au jour — et à rien d’autre', () => {
    render(<PlanningScales active="mois" />)

    expect(screen.getByRole('link', { name: 'Mois' })).toHaveAttribute('href', '/mois')
    expect(screen.getByRole('link', { name: 'Semaine' })).toHaveAttribute('href', '/semaine')
    expect(screen.getByRole('link', { name: 'Jour' })).toHaveAttribute('href', '/aujourdhui')

    // Le roulement fabrique le planning, il ne le lit pas.
    expect(screen.queryByRole('link', { name: /Roulement/i })).not.toBeInTheDocument()
    expect(screen.getAllByRole('link')).toHaveLength(3)
  })

  it('dit où l’on se trouve', () => {
    render(<PlanningScales active="semaine" />)
    expect(screen.getByRole('link', { name: 'Semaine' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Mois' })).not.toHaveAttribute('aria-current')
  })
})

describe('Le menu — le planning est un espace, le roulement un réglage', () => {
  const planningGroup = NAV.filter((i) => ['/mois', '/semaine', '/aujourdhui'].includes(i.href))

  it('ouvre le domaine sur le mois', () => {
    expect(NAV.find((i) => i.groupStart === 'Planning')?.href).toBe('/mois')
  })

  it('range les trois échelles ensemble, dans l’ordre de lecture', () => {
    expect(planningGroup.map((i) => i.label)).toEqual(['Mois', 'Semaine', 'Jour'])
  })

  it('ne présente plus le roulement comme une destination du planning', () => {
    const roulements = NAV.find((i) => i.href === '/roulements')
    // Le moteur reste ; le mot de développeur disparaît de l'écran.
    expect(roulements?.label).toBe('Planning habituel')
    expect(roulements?.groupStart).toBe('Régler le planning')
  })
})
