import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import LandingPage from '@/app/LandingPage'

describe('LandingPage', () => {
  it('renders the archive claire executive landing narrative', () => {
    render(<LandingPage />)

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: /La mémoire des lieux ne doit plus partir avec les personnes/i,
      }),
    ).toBeInTheDocument()

    expect(screen.getByText(/Médipôle — Blocs opératoires/i)).toBeInTheDocument()
    expect(screen.getByText(/Prévue dans 18 jours/i)).toBeInTheDocument()
    expect(screen.getByText(/Mémoire prête à transmettre/i)).toBeInTheDocument()

    expect(
      screen.getByRole('heading', {
        level: 2,
        name: /La connaissance d’un site tient dans quelques têtes/i,
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 2, name: /Ce que MemorIA garde/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 2, name: /MemorIA fait remonter/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 2, name: /Ce que la direction y gagne/i }),
    ).toBeInTheDocument()

    expect(screen.getByText(/Dumbéa Mall — Hall principal/i)).toBeInTheDocument()
    expect(
      screen.getByText(/Appel d’offres — marché de services multi-sites/i),
    ).toBeInTheDocument()

    expect(
      screen.getAllByRole('link', { name: /Demander une démo/i })[0],
    ).toHaveAttribute(
      'href',
      'mailto:trouillatv@gmail.com?subject=Demande%20de%20d%C3%A9mo%20MemorIA',
    )
    expect(screen.getAllByRole('link', { name: /Accéder à l’app/i })[0]).toHaveAttribute(
      'href',
      '/login',
    )
  })
})
