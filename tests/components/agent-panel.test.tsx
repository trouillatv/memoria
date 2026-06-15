import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AgentPanel } from '@/app/(dashboard)/tenders/[id]/AgentPanel'
import type { DbAgentAnalysis } from '@/types/db'

// next/navigation is referenced via useRouter().refresh()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

const TENDER_ID = '00000000-0000-0000-0000-000000000001'

function makeAnalysis(overrides: Partial<DbAgentAnalysis>): DbAgentAnalysis {
  return {
    id: 'a1',
    tender_id: TENDER_ID,
    agent_name: 'contradicteur',
    status: 'ready',
    summary: 'Synthèse',
    key_points: { items: ['risque ICPE', 'pénalités asymétriques'] },
    raw_content: null,
    metadata: { provider: 'mock' },
    error_msg: null,
    created_at: '2026-05-10T12:00:00Z',
    updated_at: '2026-05-10T12:00:00Z',
    ...overrides,
  }
}

const noop = () => {}

describe('AgentPanel — expanded mode', () => {
  it('renders all 7 agents with signature questions visible', () => {
    render(<AgentPanel tenderId={TENDER_ID} analyses={[]} onView={noop} expanded={true} onToggleExpanded={noop} />)
    expect(screen.getByText('Contradicteur')).toBeInTheDocument()
    expect(screen.getByText('Financier')).toBeInTheDocument()
    expect(screen.getByText('Lecteur de dossier')).toBeInTheDocument()
    expect(screen.getByText('Quels risques ai-je oubliés ?')).toBeInTheDocument()
    expect(screen.getByText('Cette réponse est-elle rentable ?')).toBeInTheDocument()
  })

  it('shows "Pas encore générée" for not_generated state', () => {
    render(<AgentPanel tenderId={TENDER_ID} analyses={[]} onView={noop} expanded={true} onToggleExpanded={noop} />)
    expect(screen.getAllByText(/pas encore générée/i).length).toBe(7)
  })

  it('shows generate button for not_generated state', () => {
    render(<AgentPanel tenderId={TENDER_ID} analyses={[]} onView={noop} expanded={true} onToggleExpanded={noop} />)
    expect(screen.getAllByRole('button', { name: /générer l'analyse/i }).length).toBe(7)
  })

  it('shows "Génération en cours…" for running state', () => {
    const analyses = [makeAnalysis({ agent_name: 'contradicteur', status: 'running' })]
    render(<AgentPanel tenderId={TENDER_ID} analyses={analyses} onView={noop} expanded={true} onToggleExpanded={noop} />)
    expect(screen.getByText(/génération en cours/i)).toBeInTheDocument()
  })

  it("shows 'Voir l'analyse' CTA for ready state", () => {
    const analyses = [makeAnalysis({ agent_name: 'contradicteur', status: 'ready' })]
    render(<AgentPanel tenderId={TENDER_ID} analyses={analyses} onView={noop} expanded={true} onToggleExpanded={noop} />)
    expect(screen.getByRole('button', { name: /voir l'analyse/i })).toBeInTheDocument()
  })

  it('calls onView with agent name when clicking Voir', () => {
    const onView = vi.fn()
    const analyses = [makeAnalysis({ agent_name: 'contradicteur', status: 'ready' })]
    render(<AgentPanel tenderId={TENDER_ID} analyses={analyses} onView={onView} expanded={true} onToggleExpanded={noop} />)
    fireEvent.click(screen.getByRole('button', { name: /voir l'analyse/i }))
    expect(onView).toHaveBeenCalledWith('contradicteur')
  })

  it('shows Réessayer for failed state', () => {
    const analyses = [makeAnalysis({ agent_name: 'contradicteur', status: 'failed', error_msg: 'timeout' })]
    render(<AgentPanel tenderId={TENDER_ID} analyses={analyses} onView={noop} expanded={true} onToggleExpanded={noop} />)
    expect(screen.getByRole('button', { name: /réessayer/i })).toBeInTheDocument()
    expect(screen.getByText(/erreur de génération/i)).toBeInTheDocument()
  })

  it('calls onToggleExpanded when collapse button clicked', () => {
    const onToggle = vi.fn()
    render(<AgentPanel tenderId={TENDER_ID} analyses={[]} onView={noop} expanded={true} onToggleExpanded={onToggle} />)
    fireEvent.click(screen.getByTestId('rail-collapse'))
    expect(onToggle).toHaveBeenCalled()
  })
})

describe('AgentPanel — collapsed rail', () => {
  it('renders 7 icon buttons + expand button', () => {
    render(<AgentPanel tenderId={TENDER_ID} analyses={[]} onView={noop} expanded={false} onToggleExpanded={noop} />)
    expect(screen.getByTestId('rail-icon-contradicteur')).toBeInTheDocument()
    expect(screen.getByTestId('rail-icon-financier')).toBeInTheDocument()
    expect(screen.getByTestId('rail-icon-terrain')).toBeInTheDocument()
    expect(screen.getByTestId('rail-icon-conformite')).toBeInTheDocument()
    expect(screen.getByTestId('rail-icon-memoire_technique')).toBeInTheDocument()
    expect(screen.getByTestId('rail-icon-lecteur_ao')).toBeInTheDocument()
    expect(screen.getByTestId('rail-icon-general')).toBeInTheDocument()
    expect(screen.getByTestId('rail-expand')).toBeInTheDocument()
  })

  it('does NOT render text labels in rail mode', () => {
    render(<AgentPanel tenderId={TENDER_ID} analyses={[]} onView={noop} expanded={false} onToggleExpanded={noop} />)
    expect(screen.queryByText('Contradicteur')).not.toBeInTheDocument()
  })

  it('icon aria-label includes name + status (a11y)', () => {
    render(<AgentPanel tenderId={TENDER_ID} analyses={[]} onView={noop} expanded={false} onToggleExpanded={noop} />)
    const btn = screen.getByTestId('rail-icon-contradicteur')
    const ariaLabel = btn.getAttribute('aria-label') ?? ''
    expect(ariaLabel).toContain('Contradicteur')
    expect(ariaLabel).toContain('À générer')
  })

  it('clicking ready icon calls onView with agent', () => {
    const onView = vi.fn()
    const analyses = [makeAnalysis({ agent_name: 'contradicteur', status: 'ready' })]
    render(<AgentPanel tenderId={TENDER_ID} analyses={analyses} onView={onView} expanded={false} onToggleExpanded={noop} />)
    fireEvent.click(screen.getByTestId('rail-icon-contradicteur'))
    expect(onView).toHaveBeenCalledWith('contradicteur')
  })

  it('clicking not-generated icon opens action popover (no expand, no view)', () => {
    const onToggle = vi.fn()
    const onView = vi.fn()
    render(<AgentPanel tenderId={TENDER_ID} analyses={[]} onView={onView} expanded={false} onToggleExpanded={onToggle} />)
    fireEvent.click(screen.getByTestId('rail-icon-contradicteur'))
    expect(screen.getByTestId('action-popover-contradicteur')).toBeInTheDocument()
    expect(screen.getByText(/n'a pas encore été générée/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /générer l'analyse/i })).toBeInTheDocument()
    expect(onToggle).not.toHaveBeenCalled()
    expect(onView).not.toHaveBeenCalled()
  })

  it('clicking failed icon opens action popover with Réessayer', () => {
    const analyses = [makeAnalysis({ agent_name: 'contradicteur', status: 'failed', error_msg: 'timeout' })]
    render(<AgentPanel tenderId={TENDER_ID} analyses={analyses} onView={noop} expanded={false} onToggleExpanded={noop} />)
    fireEvent.click(screen.getByTestId('rail-icon-contradicteur'))
    expect(screen.getByTestId('action-popover-contradicteur')).toBeInTheDocument()
    expect(screen.getByText(/en erreur/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /réessayer/i })).toBeInTheDocument()
  })

  it('clicking running icon does nothing (no popover, no expand, no view)', () => {
    const onToggle = vi.fn()
    const onView = vi.fn()
    const analyses = [makeAnalysis({ agent_name: 'contradicteur', status: 'running' })]
    render(<AgentPanel tenderId={TENDER_ID} analyses={analyses} onView={onView} expanded={false} onToggleExpanded={onToggle} />)
    fireEvent.click(screen.getByTestId('rail-icon-contradicteur'))
    expect(screen.queryByTestId('action-popover-contradicteur')).not.toBeInTheDocument()
    expect(onToggle).not.toHaveBeenCalled()
    expect(onView).not.toHaveBeenCalled()
  })

  it('clicking chevron is the ONLY way to expand', () => {
    const onToggle = vi.fn()
    render(<AgentPanel tenderId={TENDER_ID} analyses={[]} onView={noop} expanded={false} onToggleExpanded={onToggle} />)
    fireEvent.click(screen.getByTestId('rail-expand'))
    expect(onToggle).toHaveBeenCalled()
  })
})
