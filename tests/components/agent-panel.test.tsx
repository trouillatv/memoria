import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AgentPanel } from '@/app/(dashboard)/tenders/[id]/AgentPanel'
import type { DbAgentAnalysis } from '@/types/db'

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

describe('AgentPanel', () => {
  it('renders all 7 agents', () => {
    render(<AgentPanel tenderId={TENDER_ID} analyses={[]} onView={() => {}} />)
    expect(screen.getByText('Contradicteur')).toBeInTheDocument()
    expect(screen.getByText('Financier')).toBeInTheDocument()
    expect(screen.getByText('Lecteur AO')).toBeInTheDocument()
  })

  it('shows "Pas encore générée" for not_generated state', () => {
    render(<AgentPanel tenderId={TENDER_ID} analyses={[]} onView={() => {}} />)
    const cards = screen.getAllByText(/pas encore générée/i)
    expect(cards.length).toBe(7)
  })

  it('shows generate button for not_generated state', () => {
    render(<AgentPanel tenderId={TENDER_ID} analyses={[]} onView={() => {}} />)
    const btns = screen.getAllByRole('button', { name: /générer l'analyse/i })
    expect(btns.length).toBe(7)
  })

  it('shows "En cours" + spinner for running state', () => {
    const analyses = [makeAnalysis({ agent_name: 'contradicteur', status: 'running' })]
    render(<AgentPanel tenderId={TENDER_ID} analyses={analyses} onView={() => {}} />)
    expect(screen.getByText(/génération en cours/i)).toBeInTheDocument()
  })

  it('shows "Voir l\'analyse" CTA for ready state', () => {
    const analyses = [makeAnalysis({ agent_name: 'contradicteur', status: 'ready' })]
    render(<AgentPanel tenderId={TENDER_ID} analyses={analyses} onView={() => {}} />)
    expect(screen.getByRole('button', { name: /voir l'analyse/i })).toBeInTheDocument()
  })

  it('calls onView with agent name when clicking Voir', () => {
    const onView = vi.fn()
    const analyses = [makeAnalysis({ agent_name: 'contradicteur', status: 'ready' })]
    render(<AgentPanel tenderId={TENDER_ID} analyses={analyses} onView={onView} />)
    screen.getByRole('button', { name: /voir l'analyse/i }).click()
    expect(onView).toHaveBeenCalledWith('contradicteur')
  })

  it('shows Réessayer for failed state', () => {
    const analyses = [makeAnalysis({ agent_name: 'contradicteur', status: 'failed', error_msg: 'timeout' })]
    render(<AgentPanel tenderId={TENDER_ID} analyses={analyses} onView={() => {}} />)
    expect(screen.getByRole('button', { name: /réessayer/i })).toBeInTheDocument()
    expect(screen.getByText(/erreur de génération/i)).toBeInTheDocument()
  })
})
