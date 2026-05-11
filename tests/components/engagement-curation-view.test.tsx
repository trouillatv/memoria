import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EngagementCurationView } from '@/app/(dashboard)/tenders/[id]/engagement-curation-view'
import type { DbEngagement } from '@/types/db'

// Mock next/navigation router
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

// Mock sonner
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

// Mock server actions
vi.mock('@/app/(dashboard)/tenders/[id]/engagements-actions', () => ({
  curateEngagementAction: vi.fn(),
  rejectEngagementsAction: vi.fn(),
}))

function mkEngagement(overrides: Partial<DbEngagement> = {}): DbEngagement {
  return {
    id: 'eng-1',
    tender_id: 'tender-1',
    contract_id: null,
    short_label: 'Cantine nettoyée 2x/jour',
    description: null,
    source_excerpt: 'La cantine sera nettoyée matin et soir.',
    measurable: true,
    threshold_json: null,
    cadence_text: null,
    category: 'compliance',
    status: 'extracted',
    ai_confidence: 0.92,
    ai_provenance: null,
    embedding: null,
    embedding_model: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as DbEngagement
}

describe('EngagementCurationView — taxonomie IA masquée dans l\'UX (Slice A.5)', () => {
  it('does NOT render the engagement category as a visible chip/badge', () => {
    const engagements = [
      mkEngagement({ category: 'compliance' }),
      mkEngagement({ id: 'eng-2', category: 'delivery', short_label: 'Livraison matin' }),
      mkEngagement({ id: 'eng-3', category: 'reporting', short_label: 'Rapport mensuel' }),
      mkEngagement({ id: 'eng-4', category: 'frequency', short_label: 'Passage 3x/sem' }),
    ]
    const { container } = render(<EngagementCurationView engagements={engagements} />)

    // Display mode (not editing) must NOT show the raw category names
    // We check visible textContent (excluding offscreen aria-only nodes)
    const text = container.textContent ?? ''
    expect(text).not.toMatch(/\bcompliance\b/i)
    expect(text).not.toMatch(/\bdelivery\b/i)
    expect(text).not.toMatch(/\breporting\b/i)
    expect(text).not.toMatch(/\bfrequency\b/i)

    // But the short_label MUST be present — that's the metier identity
    expect(screen.getByText(/Cantine nettoyée 2x\/jour/)).toBeInTheDocument()
    expect(screen.getByText(/Livraison matin/)).toBeInTheDocument()
  })

  it('still shows confidence score (dev-relevant info)', () => {
    const engagements = [mkEngagement({ ai_confidence: 0.87 })]
    render(<EngagementCurationView engagements={engagements} />)
    expect(screen.getByText(/conf\. 0\.87/)).toBeInTheDocument()
  })
})
