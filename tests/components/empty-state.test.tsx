import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FileText } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'

describe('EmptyState', () => {
  it('renders title only — no icon, no description, no actions', () => {
    const { container } = render(<EmptyState title="Rien à afficher" />)
    expect(screen.getByText('Rien à afficher')).toBeInTheDocument()
    // no svg icon
    expect(container.querySelector('svg')).toBeNull()
  })

  it('renders an icon when `icon` prop is provided', () => {
    const { container } = render(<EmptyState icon={FileText} title="Vide" />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
  })

  it('renders description as a string', () => {
    render(<EmptyState title="Vide" description="Une description simple" />)
    expect(screen.getByText('Une description simple')).toBeInTheDocument()
  })

  it('renders description as JSX (links inline)', () => {
    render(
      <EmptyState
        title="Vide"
        description={
          <>
            Voir la <a href="/x">documentation</a> pour démarrer.
          </>
        }
      />,
    )
    expect(screen.getByRole('link', { name: 'documentation' })).toBeInTheDocument()
  })

  it('renders primaryAction when provided', () => {
    render(
      <EmptyState
        title="Vide"
        primaryAction={<button type="button">Commencer</button>}
      />,
    )
    expect(screen.getByRole('button', { name: 'Commencer' })).toBeInTheDocument()
  })

  it('renders both primary and secondary actions', () => {
    render(
      <EmptyState
        title="Vide"
        primaryAction={<button type="button">Importer</button>}
        secondaryAction={<button type="button">Aide</button>}
      />,
    )
    expect(screen.getByRole('button', { name: 'Importer' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Aide' })).toBeInTheDocument()
  })

  it('applies compact variant padding when variant="compact"', () => {
    const { container } = render(<EmptyState title="Vide" variant="compact" />)
    const root = container.querySelector('[data-slot="empty-state"]')
    expect(root).not.toBeNull()
    expect(root?.className).toContain('py-12')
  })

  it('applies default variant padding by default', () => {
    const { container } = render(<EmptyState title="Vide" />)
    const root = container.querySelector('[data-slot="empty-state"]')
    expect(root).not.toBeNull()
    expect(root?.className).toContain('py-20')
  })
})
