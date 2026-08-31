// P0 · Point 6 — rendu du bloc « Objets issus de cette visite » (onglet Impact).
// Les OBJETS eux-mêmes, jamais des compteurs ; « Voir plus » révèle les objets
// restants ; CTA honnête (fiche précise vs espace métier) ; populations vides non
// rendues ; visite sans objet → état « enregistrée ».

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { VisitObjectsPanel } from '@/app/(field)/m/visite/[reportId]/recap/VisitMemoryTabs'
import type { VisitObjects, VisitObjectItem } from '@/lib/db/visit-objects'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}))

function action(id: string, label: string): VisitObjectItem {
  return { id, label, statusLabel: 'Ouverte', href: `/m/site/site-1/action/${id}`, precise: true, ctaLabel: 'Voir la fiche' }
}
function reserve(id: string, label: string): VisitObjectItem {
  return { id, label, statusLabel: 'Ouverte', href: '/m/site/site-1/reserves', precise: false, ctaLabel: 'Voir les réserves' }
}
function objects(over: Partial<VisitObjects> = {}): VisitObjects {
  const base = { actions: [], reserves: [], deadlines: [], knowledge: [], isEmpty: false, ...over }
  base.isEmpty = base.actions.length + base.reserves.length + base.deadlines.length + base.knowledge.length === 0
  return base
}

describe('VisitObjectsPanel — objets réels, jamais des compteurs', () => {
  it('visite sans objet → état « enregistrée », pas de bloc objets', () => {
    render(<VisitObjectsPanel objects={objects()} />)
    expect(screen.getByText(/Cette visite a été enregistrée/)).toBeInTheDocument()
    expect(screen.queryByText('Objets issus de cette visite')).not.toBeInTheDocument()
  })

  it('ne rend que les populations présentes (pas de section vide)', () => {
    render(<VisitObjectsPanel objects={objects({ actions: [action('a1', 'Transmettre le rapport G3')] })} />)
    expect(screen.getByText('Objets issus de cette visite')).toBeInTheDocument()
    expect(screen.getByText('Actions')).toBeInTheDocument()
    expect(screen.queryByText('Réserves')).not.toBeInTheDocument()
    expect(screen.queryByText('Échéances')).not.toBeInTheDocument()
    expect(screen.queryByText('Connaissances')).not.toBeInTheDocument()
  })

  it('affiche les OBJETS (titres réels), pas un compteur « N actions »', () => {
    render(<VisitObjectsPanel objects={objects({ actions: [action('a1', 'Transmettre le rapport G3'), action('a2', 'Refaire le contrôle électrique')] })} />)
    expect(screen.getByText('Transmettre le rapport G3')).toBeInTheDocument()
    expect(screen.getByText('Refaire le contrôle électrique')).toBeInTheDocument()
    expect(screen.queryByText(/2 actions/)).not.toBeInTheDocument()
  })

  it('« Voir plus » RÉVÈLE les objets restants (ne les remplace pas par un total)', () => {
    const many = Array.from({ length: 6 }, (_, i) => action(`a${i}`, `Action ${i}`))
    render(<VisitObjectsPanel objects={objects({ actions: many })} />)
    expect(screen.getByText('Action 0')).toBeInTheDocument()
    expect(screen.queryByText('Action 5')).not.toBeInTheDocument() // masquée au départ (4 affichées)
    fireEvent.click(screen.getByRole('button', { name: /Voir plus/ }))
    expect(screen.getByText('Action 5')).toBeInTheDocument()       // révélée
    expect(screen.queryByRole('button', { name: /Voir plus/ })).not.toBeInTheDocument()
  })

  it('CTA honnête : action → « Voir la fiche » (précis) ; réserve → « Voir les réserves » (espace)', () => {
    render(<VisitObjectsPanel objects={objects({
      actions: [action('a1', 'Transmettre le rapport G3')],
      reserves: [reserve('r1', 'Contrôle électrique en retard')],
    })} />)
    const actionLink = screen.getByText('Transmettre le rapport G3').closest('a')!
    expect(actionLink).toHaveAttribute('href', '/m/site/site-1/action/a1')
    expect(within(actionLink).getByText('Voir la fiche')).toBeInTheDocument()

    const reserveLink = screen.getByText('Contrôle électrique en retard').closest('a')!
    expect(reserveLink).toHaveAttribute('href', '/m/site/site-1/reserves')
    expect(within(reserveLink).getByText('Voir les réserves')).toBeInTheDocument()
    // Jamais « Ouvrir » quand la cible est une liste.
    expect(within(reserveLink).queryByText('Ouvrir')).not.toBeInTheDocument()
  })
})
