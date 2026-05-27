import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import LandingPage from '@/app/LandingPage'

describe('LandingPage', () => {
  it('renders the archive claire executive landing narrative', () => {
    render(<LandingPage />)

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: /La memoire des lieux ne doit plus partir avec les personnes/i,
      }),
    ).toBeInTheDocument()

    expect(screen.getByText(/Medipole - Blocs operatoires/i)).toBeInTheDocument()
    expect(screen.getByText(/Releve prevue dans 18 jours/i)).toBeInTheDocument()
    expect(screen.getByText(/Memoire prete a transmettre/i)).toBeInTheDocument()

    expect(
      screen.getByRole('heading', { level: 2, name: /Quand le savoir part/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 2, name: /Ce que MemorIA garde/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 2, name: /Ce que MemorIA fait remonter/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 2, name: /Ce que la direction gagne/i }),
    ).toBeInTheDocument()

    expect(screen.getByText(/Dumbea Mall - Hall principal/i)).toBeInTheDocument()
    expect(screen.getByText(/Appel d'offres - marche de services multi-sites/i)).toBeInTheDocument()

    expect(
      screen.getAllByRole('link', { name: /Demander une demo/i })[0],
    ).toHaveAttribute(
      'href',
      'mailto:trouillatv@gmail.com?subject=Demande%20de%20d%C3%A9mo%20MemorIA',
    )
    expect(screen.getAllByRole('link', { name: /Acceder a l'app/i })[0]).toHaveAttribute(
      'href',
      '/login',
    )
  })
})
