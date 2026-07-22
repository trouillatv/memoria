import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AtRiskEngagementsWidget } from '@/app/(dashboard)/dashboard/AtRiskEngagementsWidget'
import type { AtRiskEngagement } from '@/lib/db/dashboard'

function makeEngagement(p: Partial<AtRiskEngagement> = {}): AtRiskEngagement {
  return {
    engagement_id: 'eng-1',
    short_label: 'Désinfection bloc opératoire',
    contract_id: 'ctr-1',
    contract_name: 'CHU Régional',
    reason: 'no_intervention_recent',
    reasonDetail: 'Aucune intervention exécutée depuis 4 jours',
    organizationId: 'org-1',
    ...p,
  }
}

describe('AtRiskEngagementsWidget', () => {
  it('returns null (renders nothing) when the list is empty', () => {
    const { container } = render(<AtRiskEngagementsWidget engagements={[]} />)
    // Aucun nœud DOM produit — silence positif
    expect(container.firstChild).toBeNull()
    expect(container.querySelector('[data-slot="at-risk-engagements"]')).toBeNull()
  })

  it('renders a single row with short_label + contract_name + reasonDetail', () => {
    const e = makeEngagement()
    render(<AtRiskEngagementsWidget engagements={[e]} />)
    expect(screen.getByText('Désinfection bloc opératoire')).toBeInTheDocument()
    // contract_name + reasonDetail concaténés avec « · »
    expect(
      screen.getByText(/CHU Régional · Aucune intervention exécutée depuis 4 jours/),
    ).toBeInTheDocument()
  })

  it('renders 3 rows and displays the count "(3)"', () => {
    const list: AtRiskEngagement[] = [
      makeEngagement({ engagement_id: 'e1', short_label: 'Désinfection bloc' }),
      makeEngagement({
        engagement_id: 'e2',
        short_label: 'Cantine 2x/jour',
        contract_id: 'ctr-2',
        contract_name: 'École Jaurès',
        reasonDetail: 'Aucune intervention exécutée depuis 6 jours',
      }),
      makeEngagement({
        engagement_id: 'e3',
        short_label: 'Nettoyage vitres mensuel',
        contract_id: 'ctr-3',
        contract_name: 'Mairie Centrale',
        reasonDetail: 'Aucune intervention exécutée depuis 12 jours',
      }),
    ]
    const { container } = render(<AtRiskEngagementsWidget engagements={list} />)
    const items = container.querySelectorAll('li')
    expect(items).toHaveLength(3)
    // Le compteur "(3)" apparaît dans le titre
    expect(screen.getByText('(3)')).toBeInTheDocument()
  })

  it('links each row to /contracts/[contract_id]', () => {
    const list: AtRiskEngagement[] = [
      makeEngagement({ engagement_id: 'e1', contract_id: 'ctr-abc' }),
      makeEngagement({
        engagement_id: 'e2',
        contract_id: 'ctr-xyz',
        short_label: 'Autre engagement',
      }),
    ]
    const { container } = render(<AtRiskEngagementsWidget engagements={list} />)
    const links = container.querySelectorAll('a')
    expect(links).toHaveLength(2)
    expect(links[0].getAttribute('href')).toBe('/contracts/ctr-abc')
    expect(links[1].getAttribute('href')).toBe('/contracts/ctr-xyz')
  })

  it('doctrine V3 ultime : aucun prénom typique dans le rendu', () => {
    // Le widget reçoit des données neutres (engagement + contrat). On vérifie
    // que la STRUCTURE du composant elle-même n'introduit jamais de prénom.
    const list: AtRiskEngagement[] = [
      makeEngagement(),
      makeEngagement({
        engagement_id: 'e2',
        short_label: 'Cantine 2x/jour',
        contract_name: 'École Jaurès',
        reasonDetail: 'Aucune intervention exécutée depuis 6 jours',
      }),
    ]
    const { container } = render(<AtRiskEngagementsWidget engagements={list} />)
    const text = container.textContent ?? ''
    // Liste non exhaustive de prénoms à proscrire — doctrine V3 absolue.
    const FORBIDDEN_NAMES =
      /\b(Mehdi|Léa|Lea|Sofia|Sofiane|Karim|Aïcha|Aicha|Yannick|Stéphane|Stephane|Camille|Julien|Marc|Marie|Pierre|Sophie|Aurélie|Aurelie|Nadia|Mohamed|Fatima|Sarah|Thomas|Emma|Lucas|Hugo|Léo|Leo)\b/i
    expect(text).not.toMatch(FORBIDDEN_NAMES)
  })
})
