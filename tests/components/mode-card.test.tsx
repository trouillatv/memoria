import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ModeCard } from '@/app/(dashboard)/tenders/[id]/ModeCard'

describe('ModeCard', () => {
  it('renders empty state with 0 agents', () => {
    render(<ModeCard agents={[]} onChange={() => {}} />)
    expect(screen.getByText('Choisissez un ou plusieurs experts')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sélectionner un agent/i })).toBeInTheDocument()
  })

  it('renders expert mode with 1 agent', () => {
    render(<ModeCard agents={['contradicteur']} onChange={() => {}} />)
    expect(screen.getByText("Avis d'expert")).toBeInTheDocument()
    expect(screen.getByText('Contradicteur')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ajouter un agent/i })).toBeInTheDocument()
  })

  it('renders debate mode with 2 agents and shows anticipation banner', () => {
    render(<ModeCard agents={['contradicteur', 'financier']} onChange={() => {}} />)
    expect(screen.getByText(/débat ia/i)).toBeInTheDocument()
    expect(screen.getByText(/2 perspectives/i)).toBeInTheDocument()
    expect(screen.getByText(/donneront d'abord leurs avis séparés/i)).toBeInTheDocument()
  })

  it('shows 3/3 limite atteinte at cap', () => {
    render(<ModeCard agents={['contradicteur', 'financier', 'terrain']} onChange={() => {}} />)
    expect(screen.getByText(/3\/3/)).toBeInTheDocument()
    expect(screen.getByText(/limite atteinte/i)).toBeInTheDocument()
  })

  it('removes agent on chip click', () => {
    const onChange = vi.fn()
    render(<ModeCard agents={['contradicteur', 'financier']} onChange={onChange} />)
    fireEvent.click(screen.getByTestId('chip-remove-contradicteur'))
    expect(onChange).toHaveBeenCalledWith(['financier'])
  })

  it('opens popover on add button click', () => {
    render(<ModeCard agents={['contradicteur']} onChange={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /ajouter un agent/i }))
    expect(screen.getByRole('dialog', { name: /sélectionner les agents/i })).toBeInTheDocument()
  })
})
