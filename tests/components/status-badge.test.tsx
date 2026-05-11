import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusBadge, statusLabel } from '@/components/ui/status-badge'

describe('StatusBadge', () => {
  it('renders intervention "planned" with French label and slate tone', () => {
    const { container } = render(<StatusBadge status="planned" />)
    expect(screen.getByText('Planifiée')).toBeInTheDocument()
    const root = container.querySelector('[data-slot="status-badge"]')
    expect(root).not.toBeNull()
    expect(root?.className).toContain('bg-slate-50')
    expect(root?.className).toContain('text-slate-700')
  })

  it('renders intervention "completed" as « Exécutée » with emerald tone', () => {
    const { container } = render(<StatusBadge status="completed" />)
    expect(screen.getByText('Exécutée')).toBeInTheDocument()
    const root = container.querySelector('[data-slot="status-badge"]')
    expect(root?.className).toContain('bg-emerald-50')
    expect(root?.className).toContain('text-emerald-800')
  })

  it('renders intervention "validated" as « Validée »', () => {
    render(<StatusBadge status="validated" />)
    expect(screen.getByText('Validée')).toBeInTheDocument()
  })

  it('renders intervention "skipped" as « Sautée » with amber tone', () => {
    const { container } = render(<StatusBadge status="skipped" />)
    expect(screen.getByText('Sautée')).toBeInTheDocument()
    const root = container.querySelector('[data-slot="status-badge"]')
    expect(root?.className).toContain('bg-amber-50')
    expect(root?.className).toContain('text-amber-800')
  })

  it('renders contract "active" as « Actif »', () => {
    render(<StatusBadge status="active" />)
    expect(screen.getByText('Actif')).toBeInTheDocument()
  })

  it('renders tender "failed" as « Échec » with rose tone', () => {
    const { container } = render(<StatusBadge status="failed" />)
    expect(screen.getByText('Échec')).toBeInTheDocument()
    const root = container.querySelector('[data-slot="status-badge"]')
    expect(root?.className).toContain('bg-rose-50')
    expect(root?.className).toContain('text-rose-800')
  })

  it('gracefully renders unknown status as raw value with neutral muted tone', () => {
    const { container } = render(<StatusBadge status="unknown_status" />)
    expect(screen.getByText('unknown_status')).toBeInTheDocument()
    const root = container.querySelector('[data-slot="status-badge"]')
    expect(root?.className).toContain('text-muted-foreground')
  })

  it('applies md size classes when size="md"', () => {
    const { container } = render(<StatusBadge status="active" size="md" />)
    const root = container.querySelector('[data-slot="status-badge"]')
    expect(root?.className).toContain('px-2.5')
    expect(root?.className).toContain('py-1')
    expect(root?.className).toContain('text-xs')
  })

  it('statusLabel("curated") returns « Validée »', () => {
    expect(statusLabel('curated')).toBe('Validée')
  })

  it('statusLabel falls back to raw string for unknown values', () => {
    expect(statusLabel('not_a_status')).toBe('not_a_status')
  })
})
