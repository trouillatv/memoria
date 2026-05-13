import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DashboardHeader } from '@/app/(dashboard)/dashboard/DashboardHeader'
import { StatsBand } from '@/app/(dashboard)/dashboard/StatsBand'
import type {
  WeekPulse,
  CapitalPreuves,
  AOPipeline,
  OpenAnomaliesStats,
} from '@/lib/db/dashboard'

function makeWeekPulse(p: Partial<WeekPulse> = {}): WeekPulse {
  return {
    interventionsExecuted: 0,
    photosCount: 0,
    validationsCount: 0,
    ...p,
  }
}
function makeCapital(p: Partial<CapitalPreuves> = {}): CapitalPreuves {
  return {
    totalPhotos: 0,
    totalInterventionsExecuted: 0,
    totalContractsActive: 0,
    ...p,
  }
}
function makeAO(p: Partial<AOPipeline> = {}): AOPipeline {
  return { analyzing: 0, ready: 0, submitted: 0, renewalsDue: 0, ...p }
}
function makeAnomalies(p: Partial<OpenAnomaliesStats> = {}): OpenAnomaliesStats {
  return { total: 0, oldCount: 0, ...p }
}

describe('DashboardHeader', () => {
  it('greets the user by first name', () => {
    render(<DashboardHeader firstName="Aurélie" activeContractsCount={3} />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Bonjour Aurélie.')
  })

  it('uses plural for activeContractsCount > 1', () => {
    render(<DashboardHeader firstName="Aurélie" activeContractsCount={3} />)
    expect(screen.getByText(/3 contrats actifs\./i)).toBeInTheDocument()
  })

  it('uses singular for activeContractsCount = 1', () => {
    render(<DashboardHeader firstName="Aurélie" activeContractsCount={1} />)
    expect(screen.getByText(/1 contrat actif\./i)).toBeInTheDocument()
    // Doit afficher singulier strict — pas "1 contrats actifs"
    expect(screen.queryByText(/1 contrats actifs/i)).toBeNull()
  })

  it('renders a date label in French (capitalized weekday + month + year)', () => {
    const { container } = render(
      <DashboardHeader firstName="Aurélie" activeContractsCount={2} />,
    )
    const header = container.querySelector('[data-slot="dashboard-header"]')
    expect(header).not.toBeNull()
    // Le format FR contient l'année à 4 chiffres et un nom de mois en lettres.
    const year = String(new Date().getFullYear())
    expect(header?.textContent ?? '').toContain(year)
  })
})

describe('StatsBand', () => {
  it('renders all four stat cards', () => {
    const { container } = render(
      <StatsBand
        weekPulse={makeWeekPulse()}
        capital={makeCapital()}
        aoPipeline={makeAO()}
        anomalies={makeAnomalies()}
      />,
    )
    const cards = container.querySelectorAll('[data-slot="stat-card"]')
    expect(cards).toHaveLength(4)
  })

  it('shows weekPulse stats (interventions / photos / validations) in the week card', () => {
    render(
      <StatsBand
        weekPulse={makeWeekPulse({
          interventionsExecuted: 47,
          photosCount: 198,
          validationsCount: 12,
        })}
        capital={makeCapital()}
        aoPipeline={makeAO()}
        anomalies={makeAnomalies()}
      />,
    )
    const weekCard = screen.getByTestId('stat-week')
    // Les trois valeurs du week pulse sont visibles dans la card "Cette semaine".
    expect(weekCard).toHaveTextContent('47')
    expect(weekCard).toHaveTextContent('198')
    expect(weekCard).toHaveTextContent('12')
    expect(weekCard).toHaveTextContent('interventions')
    expect(weekCard).toHaveTextContent('photos')
    expect(weekCard).toHaveTextContent('validations')
  })

  it('displays "Aucune anomalie ouverte." when anomalies.total = 0', () => {
    render(
      <StatsBand
        weekPulse={makeWeekPulse()}
        capital={makeCapital()}
        aoPipeline={makeAO()}
        anomalies={makeAnomalies({ total: 0, oldCount: 0 })}
      />,
    )
    const anomaliesCard = screen.getByTestId('stat-anomalies')
    expect(anomaliesCard).toHaveTextContent('Aucune anomalie ouverte.')
    // Pas de label "ouvertes" / "depuis +3 jours" quand vide
    expect(anomaliesCard).not.toHaveTextContent(/depuis \+3 jours/i)
  })

  it('shows total but hides "depuis +3 jours" when oldCount = 0', () => {
    render(
      <StatsBand
        weekPulse={makeWeekPulse()}
        capital={makeCapital()}
        aoPipeline={makeAO()}
        anomalies={makeAnomalies({ total: 2, oldCount: 0 })}
      />,
    )
    const anomaliesCard = screen.getByTestId('stat-anomalies')
    expect(anomaliesCard).toHaveTextContent('2')
    expect(anomaliesCard).toHaveTextContent('ouvertes')
    expect(anomaliesCard).not.toHaveTextContent(/depuis \+3 jours/i)
  })

  it('shows the +3 days sub-stat when oldCount > 0', () => {
    render(
      <StatsBand
        weekPulse={makeWeekPulse()}
        capital={makeCapital()}
        aoPipeline={makeAO()}
        anomalies={makeAnomalies({ total: 2, oldCount: 1 })}
      />,
    )
    const anomaliesCard = screen.getByTestId('stat-anomalies')
    expect(anomaliesCard).toHaveTextContent(/depuis \+3 jours/i)
  })
})
