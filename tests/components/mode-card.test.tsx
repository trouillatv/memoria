import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ModeCard } from '@/app/(dashboard)/tenders/[id]/ModeCard'

describe('ModeCard — empty state (declarative onboarding)', () => {
  it('renders welcome question and helper text', () => {
    render(<ModeCard agents={[]} onChange={() => {}} />)
    expect(screen.getByText(/à qui voulez-vous parler/i)).toBeInTheDocument()
    expect(screen.getByText(/1 expert pour un avis · 2-3 pour un débat ia/i)).toBeInTheDocument()
  })

  it('renders 7 agent chips with signature questions visible', () => {
    render(<ModeCard agents={[]} onChange={() => {}} />)
    expect(screen.getByTestId('mode-chip-contradicteur')).toBeInTheDocument()
    expect(screen.getByTestId('mode-chip-financier')).toBeInTheDocument()
    expect(screen.getByTestId('mode-chip-terrain')).toBeInTheDocument()
    expect(screen.getByTestId('mode-chip-conformite')).toBeInTheDocument()
    expect(screen.getByTestId('mode-chip-memoire_technique')).toBeInTheDocument()
    expect(screen.getByTestId('mode-chip-lecteur_ao')).toBeInTheDocument()
    expect(screen.getByTestId('mode-chip-general')).toBeInTheDocument()
    expect(screen.getByText('Quels risques ai-je oubliés ?')).toBeInTheDocument()
    expect(screen.getByText('Cette réponse est-elle rentable ?')).toBeInTheDocument()
  })

  it('clicking a chip selects that agent', () => {
    const onChange = vi.fn()
    render(<ModeCard agents={[]} onChange={onChange} />)
    fireEvent.click(screen.getByTestId('mode-chip-contradicteur'))
    expect(onChange).toHaveBeenCalledWith(['contradicteur'])
  })
})

describe('ModeCard — expert mode (1 agent)', () => {
  it('renders declarative "Vous consultez X"', () => {
    render(<ModeCard agents={['contradicteur']} onChange={() => {}} />)
    expect(screen.getByText("Avis d'expert")).toBeInTheDocument()
    expect(screen.getByText(/vous consultez/i)).toBeInTheDocument()
    expect(screen.getByText('Contradicteur')).toBeInTheDocument()
  })

  it('shows add CTA hinting at debate transition', () => {
    render(<ModeCard agents={['contradicteur']} onChange={() => {}} />)
    expect(screen.getByRole('button', { name: /ajouter un expert pour confronter/i })).toBeInTheDocument()
  })

  it('opens popover on add button click', () => {
    render(<ModeCard agents={['contradicteur']} onChange={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /ajouter un expert/i }))
    expect(screen.getByRole('dialog', { name: /sélectionner les agents/i })).toBeInTheDocument()
  })

  it('removes the only agent on chip-remove click (back to empty)', () => {
    const onChange = vi.fn()
    render(<ModeCard agents={['contradicteur']} onChange={onChange} />)
    fireEvent.click(screen.getByTestId('chip-remove-contradicteur'))
    expect(onChange).toHaveBeenCalledWith([])
  })
})

describe('ModeCard — debate mode (2-3 agents)', () => {
  it('renders "N perspectives vont confronter"', () => {
    render(<ModeCard agents={['contradicteur', 'financier']} onChange={() => {}} />)
    expect(screen.getByText('Débat IA')).toBeInTheDocument()
    expect(screen.getByText(/2 perspectives vont confronter leurs analyses/i)).toBeInTheDocument()
  })

  it('renders all selected agent chips', () => {
    render(<ModeCard agents={['contradicteur', 'financier', 'terrain']} onChange={() => {}} />)
    expect(screen.getByTestId('chip-remove-contradicteur')).toBeInTheDocument()
    expect(screen.getByTestId('chip-remove-financier')).toBeInTheDocument()
    expect(screen.getByTestId('chip-remove-terrain')).toBeInTheDocument()
  })

  it('shows ratio in add CTA below cap', () => {
    render(<ModeCard agents={['contradicteur', 'financier']} onChange={() => {}} />)
    expect(screen.getByRole('button', { name: /ajouter un expert.*2\/3/i })).toBeInTheDocument()
  })

  it('shows "3/3 limite atteinte" at cap, disabled', () => {
    render(<ModeCard agents={['contradicteur', 'financier', 'terrain']} onChange={() => {}} />)
    const btn = screen.getByRole('button', { name: /3\/3.*limite atteinte/i })
    expect(btn).toBeDisabled()
  })

  it('removes one agent on chip-remove click', () => {
    const onChange = vi.fn()
    render(<ModeCard agents={['contradicteur', 'financier']} onChange={onChange} />)
    fireEvent.click(screen.getByTestId('chip-remove-contradicteur'))
    expect(onChange).toHaveBeenCalledWith(['financier'])
  })
})
