import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { SituationAttentionCard } from '@/app/(dashboard)/dashboard/SituationAttentionCard'
import type { AttentionCard } from '@/lib/situations/attention/types'

const card: AttentionCard = {
  id: 'signal-1',
  icon: 'calendar',
  tone: 'amber',
  priority: 55,
  title: 'Planning toujours non diffusé',
  description: 'Annonce faite lors de la visite du 21 juillet.',
  siteLabel: 'Lycée PETRO ATTITI',
  organizationLabel: 'Demo Org',
  timingLabel: 'Échéance dépassée depuis 19 jours',
  sourceLabel: 'Visite du 21 juillet',
  primaryAction: { kind: 'open_source', label: 'Voir la source', href: '/visites/visit-1' },
  secondaryActions: [
    { kind: 'open_source', label: 'Ouvrir la visite', href: '/visites/visit-1' },
  ],
  subject: null,
  resolutions: [],
}

describe('SituationAttentionCard', () => {
  it('rend le titre et les métadonnées compactes sans interaction', () => {
    render(<SituationAttentionCard card={card} />)

    expect(screen.getByText('Planning toujours non diffusé')).toBeInTheDocument()
    expect(screen.getByText(/Lycée PETRO ATTITI/)).toBeInTheDocument()
    expect(screen.getByText(/Échéance dépassée depuis 19 jours/)).toBeInTheDocument()
  })

  it("rend la description, l'organisation et les liens après expansion", () => {
    render(<SituationAttentionCard card={card} />)

    fireEvent.click(screen.getByRole('button', { name: /plus d'actions/i }))

    expect(screen.getByText('Annonce faite lors de la visite du 21 juillet.')).toBeInTheDocument()
    expect(screen.getByText('Demo Org')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Voir la source' })).toHaveAttribute('href', '/visites/visit-1')
    expect(screen.getByRole('link', { name: 'Ouvrir la visite' })).toHaveAttribute('href', '/visites/visit-1')
  })

  it("n'invente pas de lien source quand la source manque", () => {
    render(<SituationAttentionCard card={{ ...card, primaryAction: undefined, secondaryActions: [] }} />)
    const btn = screen.queryByRole('button', { name: /plus d'actions/i })
    if (btn) fireEvent.click(btn)
    expect(screen.queryByRole('link', { name: 'Voir la source' })).not.toBeInTheDocument()
  })

  it("n'affiche pas l'organisation quand elle manque", () => {
    render(<SituationAttentionCard card={{ ...card, organizationLabel: undefined }} />)
    fireEvent.click(screen.getByRole('button', { name: /plus d'actions/i }))
    expect(screen.queryByText('Demo Org')).not.toBeInTheDocument()
  })

  it('ne dépend pas des propriétés techniques du signal dans son implémentation', () => {
    const source = readFileSync('app/(dashboard)/dashboard/SituationAttentionCard.tsx', 'utf8')
    expect(source).not.toMatch(/MemorySignal|facts|trigger|category|reason/)
  })
})
