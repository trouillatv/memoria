import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { SituationNowCard } from '@/app/(dashboard)/dashboard/SituationNowCard'
import type { NowCard } from '@/lib/situations/now/types'

const card: NowCard = {
  id: 'signal-1',
  icon: 'document',
  tone: 'neutral',
  title: 'Annonce à confirmer',
  description: 'Aucune échéance structurée n’est disponible pour cette annonce.',
  siteLabel: 'CAFAT Centre-ville',
  organizationLabel: 'Demo Org',
  timingLabel: 'Aucune confirmation depuis 15 jours',
  sourceLabel: 'Visite du 21 juillet',
  primaryAction: { kind: 'open_source', label: 'Voir la source', href: '/visites/visit-1' },
  secondaryActions: [{ kind: 'open_source', label: 'Ouvrir la visite', href: '/visites/visit-1' }],
}

describe('SituationNowCard', () => {
  it('rend la carte Now simple avec ses actions', () => {
    render(<SituationNowCard card={card} />)

    expect(screen.getByText('Annonce à confirmer')).toBeInTheDocument()
    expect(screen.getByText('Aucune échéance structurée n’est disponible pour cette annonce.')).toBeInTheDocument()
    expect(screen.getByText('CAFAT Centre-ville')).toBeInTheDocument()
    expect(screen.getByText('Demo Org')).toBeInTheDocument()
    expect(screen.getByText('Aucune confirmation depuis 15 jours')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Voir la source' })).toHaveAttribute('href', '/visites/visit-1')
    expect(screen.getByRole('link', { name: 'Ouvrir la visite' })).toHaveAttribute('href', '/visites/visit-1')
  })

  it('n’ajoute pas de bouton fictif quand aucune action n’existe', () => {
    render(<SituationNowCard card={{ ...card, primaryAction: undefined, secondaryActions: [] }} />)

    expect(screen.queryByRole('link', { name: 'Voir la source' })).not.toBeInTheDocument()
  })

  it('ne dépend pas des propriétés techniques du signal dans son implémentation', () => {
    const source = readFileSync('app/(dashboard)/dashboard/SituationNowCard.tsx', 'utf8')
    expect(source).not.toMatch(/MemorySignal|facts|trigger|category|reason/)
  })
})
