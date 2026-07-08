import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import NotFound from '@/app/not-found'
import ErrorPage from '@/app/error'
import DashboardNotFound from '@/app/(dashboard)/not-found'
import FieldNotFound from '@/app/(field)/not-found'

describe('NotFound (app/not-found.tsx)', () => {
  it('renders "Page introuvable" heading and back-to-dashboard button', () => {
    render(<NotFound />)
    expect(
      screen.getByRole('heading', { name: 'Page introuvable' }),
    ).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /tableau de bord/i })
    expect(link).toBeInTheDocument()
    expect(link.getAttribute('href')).toBe('/dashboard')
  })

  it('contains the reassuring "preuves restent en sécurité" message', () => {
    render(<NotFound />)
    expect(
      screen.getByText(/preuves restent en sécurité/i),
    ).toBeInTheDocument()
  })
})

describe('ErrorPage (app/error.tsx)', () => {
  it('renders title and Réessayer button that calls reset()', () => {
    const reset = vi.fn()
    const error = new Error('boom')
    render(<ErrorPage error={error} reset={reset} />)

    expect(
      screen.getByRole('heading', { name: /quelque chose s'est passé/i }),
    ).toBeInTheDocument()

    const retryBtn = screen.getByRole('button', { name: /réessayer/i })
    expect(retryBtn).toBeInTheDocument()
    fireEvent.click(retryBtn)
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('displays error.digest when present', () => {
    const reset = vi.fn()
    const error = Object.assign(new Error('boom'), { digest: 'abc123' })
    render(<ErrorPage error={error} reset={reset} />)
    expect(screen.getByText(/Référence\s*:\s*abc123/)).toBeInTheDocument()
  })

  it('omits digest reference when absent', () => {
    const reset = vi.fn()
    const error = new Error('boom')
    render(<ErrorPage error={error} reset={reset} />)
    expect(screen.queryByText(/Référence\s*:/)).toBeNull()
  })

  it('renders fallback retour tableau de bord link', () => {
    const reset = vi.fn()
    render(<ErrorPage error={new Error('boom')} reset={reset} />)
    const link = screen.getByRole('link', { name: /tableau de bord/i })
    expect(link.getAttribute('href')).toBe('/dashboard')
  })
})

describe('DashboardNotFound (app/(dashboard)/not-found.tsx)', () => {
  it('renders EmptyState with title and dashboard CTA', () => {
    const { container } = render(<DashboardNotFound />)
    expect(container.querySelector('[data-slot="empty-state"]')).not.toBeNull()
    expect(
      screen.getByRole('heading', { name: 'Page introuvable' }),
    ).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /tableau de bord/i })
    expect(link.getAttribute('href')).toBe('/dashboard')
  })
})

describe('FieldNotFound (app/(field)/not-found.tsx)', () => {
  it('renders compact EmptyState with home CTA', () => {
    const { container } = render(<FieldNotFound />)
    const root = container.querySelector('[data-slot="empty-state"]')
    expect(root).not.toBeNull()
    // compact variant → py-12
    expect(root?.className).toContain('py-12')

    // Depuis l'écran mobile Réunions (#53), le CTA est « Retour à l'accueil » → /m.
    const link = screen.getByRole('link', { name: /retour à l'accueil/i })
    expect(link.getAttribute('href')).toBe('/m')
  })
})
