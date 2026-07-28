// V3 étape 5B — rendu du bloc « Travaille principalement avec » + « Pourquoi
// proche ? ». Vérifie : état vide honnête, statut factuel (pas de faux qualificatif
// sur insufficient_data), récence « actif actuellement » pour une durée active,
// dépliage des preuves avec source cliquable, force totale.

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

import { ActorRelationsPanel } from '@/app/(dashboard)/intervenants/graph/ActorRelationsPanel'
import { groupEcosystem, type ActorRelationView } from '@/lib/knowledge/actor-relation-view'

function view(over: Partial<ActorRelationView> = {}): ActorRelationView {
  return {
    actor: { kind: 'company', id: 'coA', label: 'Entreprise Alpha', href: '/intervenants/entreprise/coA' },
    relationType: 'co_casting', rawStrength: 4, strength: 4,
    activity: { current: 2, previous: 2, delta: 0, trend: 'stable' },
    strengthEvolution: { current: 4, previous: 4, delta: 0 },
    daysSinceLastInteraction: 0, activeInteractionCount: 1, interactionCount: 2,
    explanation: [{
      interactionType: 'co_casting', sourceId: 's1', sourceLabel: 'Chantier Petro Attiti', sourceHref: '/sites/s1',
      observedAt: null, activeFrom: '2024-03-12', activeTo: null, isActive: true, rawContribution: 2, currentContribution: 4,
    }],
    ...over,
  }
}
const result = (views: ActorRelationView[]) => ({ relations: views, ecosystem: groupEcosystem(views) })

describe('ActorRelationsPanel', () => {
  it('état vide honnête (aucun jugement)', () => {
    render(<ActorRelationsPanel data={result([])} />)
    expect(screen.getByText('Aucune collaboration structurelle connue avec cet acteur.')).toBeTruthy()
    expect(screen.queryByText(/isolé|faible|réseau/i)).toBeNull()
  })

  it('relation active → « Activité stable » + « actif actuellement »', () => {
    render(<ActorRelationsPanel data={result([view()])} />)
    expect(screen.getByText('Entreprise Alpha')).toBeTruthy()
    expect(screen.getByText('Activité stable')).toBeTruthy()
    expect(document.body.textContent).toContain('actif actuellement') // partage le <p> avec la force
    expect(document.body.textContent).toContain('Force 4,0')
  })

  it('insufficient_data → statut factuel, aucun qualificatif de tendance', () => {
    render(<ActorRelationsPanel data={result([view({ activity: { current: 0, previous: 3, delta: -3, trend: 'insufficient_data' }, interactionCount: 1, activeInteractionCount: 0, daysSinceLastInteraction: 120 })])} />)
    expect(screen.getByText('1 interaction observée')).toBeTruthy()
    expect(screen.queryByText(/en hausse|en baisse|stable/i)).toBeNull()
  })

  it('« Pourquoi proche ? » déplie les preuves avec source cliquable + force totale', () => {
    render(<ActorRelationsPanel data={result([view()])} />)
    fireEvent.click(screen.getByLabelText('Pourquoi proche ?'))
    const src = screen.getByText('Chantier Petro Attiti')
    expect(src.closest('a')?.getAttribute('href')).toBe('/sites/s1') // cliquable
    expect(screen.getByText(/Force totale/)).toBeTruthy()
  })
})
