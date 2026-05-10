import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AgentAnalysisDrawer } from '@/app/(dashboard)/tenders/[id]/AgentAnalysisDrawer'
import type { DbAgentAnalysis } from '@/types/db'

function makeAnalysis(overrides: Partial<DbAgentAnalysis> = {}): DbAgentAnalysis {
  return {
    id: 'a1',
    tender_id: 't1',
    agent_name: 'contradicteur',
    status: 'ready',
    summary: 'Deux risques ICPE majeurs identifiés sur le périmètre.',
    key_points: { items: ['Risque ICPE article 4', 'Pénalités asymétriques'] },
    raw_content: null,
    metadata: { provider: 'mock', input_tokens: 1200, output_tokens: 800 },
    error_msg: null,
    created_at: '2026-05-10T12:00:00Z',
    updated_at: '2026-05-10T12:00:00Z',
    ...overrides,
  }
}

describe('AgentAnalysisDrawer', () => {
  it('returns null when analysis is null', () => {
    const { container } = render(
      <AgentAnalysisDrawer
        open={true}
        analysis={null}
        tenderId="t1"
        onOpenChange={() => {}}
      />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders summary and key points when ready', () => {
    render(
      <AgentAnalysisDrawer
        open={true}
        analysis={makeAnalysis()}
        tenderId="t1"
        onOpenChange={() => {}}
      />
    )
    expect(screen.getByText(/synthèse/i)).toBeInTheDocument()
    expect(screen.getByText(/risque icpe article 4/i)).toBeInTheDocument()
    expect(screen.getByText(/pénalités asymétriques/i)).toBeInTheDocument()
  })

  it('renders metadata block (provider + tokens)', () => {
    render(
      <AgentAnalysisDrawer
        open={true}
        analysis={makeAnalysis()}
        tenderId="t1"
        onOpenChange={() => {}}
      />
    )
    expect(screen.getByText(/mock/i)).toBeInTheDocument()
    expect(screen.getByText(/2 000 tokens/i)).toBeInTheDocument()
  })

  it('exposes Régénérer button', () => {
    render(
      <AgentAnalysisDrawer
        open={true}
        analysis={makeAnalysis()}
        tenderId="t1"
        onOpenChange={() => {}}
      />
    )
    expect(screen.getByRole('button', { name: /régénérer/i })).toBeInTheDocument()
  })

  it('returns null when open is false', () => {
    const { container } = render(
      <AgentAnalysisDrawer
        open={false}
        analysis={makeAnalysis()}
        tenderId="t1"
        onOpenChange={() => {}}
      />
    )
    expect(container.firstChild).toBeNull()
  })
})
