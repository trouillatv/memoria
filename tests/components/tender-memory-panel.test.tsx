import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { TenderMemoryPanel } from '@/app/(dashboard)/tenders/[id]/TenderMemoryPanel'
import type { SimilarTenderMemory } from '@/lib/db/tenders'

function fakeTender(p: Partial<SimilarTenderMemory>): SimilarTenderMemory {
  return {
    id: p.id ?? '11111111-1111-1111-1111-111111111111',
    title: p.title ?? 'AO test',
    client_name: p.client_name ?? null,
    outcome: p.outcome ?? 'lost',
    outcome_at: p.outcome_at ?? '2025-12-15T10:00:00Z',
    outcome_reason: p.outcome_reason ?? null,
    outcome_tag: p.outcome_tag ?? null,
    similarity: p.similarity ?? 0.42,
  }
}

describe('TenderMemoryPanel — doctrine V5 MC-2', () => {
  it('liste vide → composant ne rend rien (silence positif)', () => {
    const { container } = render(<TenderMemoryPanel similarTenders={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('1 AO perdu avec reason + tag → labels affichés (descriptif)', () => {
    const { container, getByText } = render(
      <TenderMemoryPanel
        similarTenders={[
          fakeTender({
            id: 'aaa11111-1111-1111-1111-111111111111',
            title: 'Lycée Champêtre nettoyage',
            client_name: 'Province Sud',
            outcome: 'lost',
            outcome_at: '2025-12-15T10:00:00Z',
            outcome_reason: 'Concurrent moins cher de 8%',
            outcome_tag: 'prix',
          }),
        ]}
      />,
    )

    // Header + sous-titre
    expect(getByText('Mémoire des dossiers similaires')).toBeInTheDocument()
    expect(getByText(/Dossiers comparables dans l/)).toBeInTheDocument()

    // Badge perdu
    expect(getByText('perdu')).toBeInTheDocument()
    // Tag prix
    expect(getByText('prix')).toBeInTheDocument()
    // Reason en citation italique
    expect(container.textContent).toContain('Concurrent moins cher de 8%')
    // Date mois+année lisible
    expect(container.textContent?.toLowerCase()).toContain('décembre')
    expect(container.textContent).toContain('2025')
    // Titre + client
    expect(getByText('Lycée Champêtre nettoyage')).toBeInTheDocument()
    expect(getByText('Province Sud')).toBeInTheDocument()
  })

  it('1 AO gagné sans reason → badge gagné, pas de citation', () => {
    const { container, getByText, queryByText } = render(
      <TenderMemoryPanel
        similarTenders={[
          fakeTender({
            id: 'bbb22222-2222-2222-2222-222222222222',
            title: 'École Sainte-Marie',
            client_name: 'DDEC',
            outcome: 'won',
            outcome_at: '2025-03-20T10:00:00Z',
            outcome_reason: null,
            outcome_tag: null,
          }),
        ]}
      />,
    )

    expect(getByText('gagné')).toBeInTheDocument()
    expect(queryByText('perdu')).toBeNull()
    // Pas de guillemets de citation puisque aucune reason
    expect(container.textContent).not.toMatch(/«[^»]*»/)
  })

  it('doctrine V5 — aucun mot interdit dans le DOM (verrou V1 + V4)', () => {
    const { container } = render(
      <TenderMemoryPanel
        similarTenders={[
          fakeTender({
            id: 'ccc33333-3333-3333-3333-333333333333',
            title: 'OPT-NC nettoyage bureaux',
            client_name: 'OPT-NC',
            outcome: 'lost',
            outcome_reason: 'Référent client connaissait déjà le concurrent',
            outcome_tag: 'relation',
          }),
          fakeTender({
            id: 'ddd44444-4444-4444-4444-444444444444',
            title: 'École primaire',
            client_name: 'Mairie',
            outcome: 'won',
            outcome_reason: null,
            outcome_tag: null,
          }),
        ]}
      />,
    )

    // Doctrine V5 — aucun mot d'injonction commerciale.
    expect(container.textContent).not.toMatch(
      /conseil|reprenez|devriez|baissez|augmentez|attention.*prix|prochaine fois|n['’]oubliez|recommandons/i,
    )
    // Pas non plus de score/classement/%/funnel
    expect(container.textContent).not.toMatch(/score|classement|funnel|\b\d+\s*%/i)
  })
})
