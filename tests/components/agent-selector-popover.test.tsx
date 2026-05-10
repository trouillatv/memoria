import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AgentSelectorPopover } from '@/app/(dashboard)/tenders/[id]/AgentSelectorPopover'

describe('AgentSelectorPopover', () => {
  it('renders all 7 agents when open', () => {
    render(
      <AgentSelectorPopover
        open={true}
        onOpenChange={() => {}}
        selected={[]}
        onChange={() => {}}
      />
    )
    expect(screen.getByText('Contradicteur')).toBeInTheDocument()
    expect(screen.getByText('Financier')).toBeInTheDocument()
    expect(screen.getByText('Terrain')).toBeInTheDocument()
    expect(screen.getByText('Conformité')).toBeInTheDocument()
    expect(screen.getByText('Mémoire technique')).toBeInTheDocument()
    expect(screen.getByText('Lecteur AO')).toBeInTheDocument()
    expect(screen.getByText('Général')).toBeInTheDocument()
  })

  it('shows checkmark on selected agents', () => {
    render(
      <AgentSelectorPopover
        open={true}
        onOpenChange={() => {}}
        selected={['contradicteur']}
        onChange={() => {}}
      />
    )
    const row = screen.getByTestId('agent-row-contradicteur')
    expect(row).toHaveAttribute('aria-checked', 'true')
  })

  it('calls onChange with toggled agent', () => {
    const onChange = vi.fn()
    render(
      <AgentSelectorPopover
        open={true}
        onOpenChange={() => {}}
        selected={[]}
        onChange={onChange}
      />
    )
    fireEvent.click(screen.getByTestId('agent-row-contradicteur'))
    expect(onChange).toHaveBeenCalledWith(['contradicteur'])
  })

  it('caps selection to 3', () => {
    const onChange = vi.fn()
    render(
      <AgentSelectorPopover
        open={true}
        onOpenChange={() => {}}
        selected={['contradicteur', 'financier', 'terrain']}
        onChange={onChange}
      />
    )
    fireEvent.click(screen.getByTestId('agent-row-conformite'))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByTestId('agent-row-conformite')).toBeDisabled()
  })

  it('filters by search query', () => {
    render(
      <AgentSelectorPopover
        open={true}
        onOpenChange={() => {}}
        selected={[]}
        onChange={() => {}}
      />
    )
    fireEvent.change(screen.getByPlaceholderText('Rechercher un agent…'), {
      target: { value: 'contradi' },
    })
    expect(screen.getByText('Contradicteur')).toBeInTheDocument()
    expect(screen.queryByText('Financier')).not.toBeInTheDocument()
  })

  it('shows counter X/3', () => {
    render(
      <AgentSelectorPopover
        open={true}
        onOpenChange={() => {}}
        selected={['contradicteur', 'financier']}
        onChange={() => {}}
      />
    )
    expect(screen.getByText('2/3 sélectionnés')).toBeInTheDocument()
  })

  it('returns null when closed', () => {
    const { container } = render(
      <AgentSelectorPopover
        open={false}
        onOpenChange={() => {}}
        selected={[]}
        onChange={() => {}}
      />
    )
    expect(container.firstChild).toBeNull()
  })
})
