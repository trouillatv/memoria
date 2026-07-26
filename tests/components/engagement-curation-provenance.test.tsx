// Curation — libellé de source (presenter partagé) + FILTRE PAR DOCUMENT.
// Couvre : filtre « Tous », filtre sur une pièce précise, sur le mémoire, sur le
// non-localisé (seulement s'il existe), combinaison filtre+regroupement, deux
// pièces de nom identique mais d'ID différents, reset, et cohérence badge↔filtre.

import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { EngagementCurationView } from '@/app/(dashboard)/tenders/[id]/engagement-curation-view'
import { engagementSourceDisplay } from '@/lib/tenders/engagement-source-display'
import type { DbEngagement } from '@/types/db'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

function engagement(p: Partial<DbEngagement>): DbEngagement {
  return {
    id: p.id ?? 'e-1', tender_id: 't-1', contract_id: null, source_type: 'ao_clause',
    source_excerpt: p.source_excerpt ?? 'clause', source_ref: null,
    tender_document_id: null, page_number: null, category: 'compliance',
    kind: p.kind ?? 'obligation', short_label: p.short_label ?? 'Engagement',
    measurable: true, ai_confidence: 0.9, status: 'extracted', proof_requirement: 'none',
    destination: 'contract_engagement', created_at: '2026-07-27T00:00:00Z',
    updated_at: '2026-07-27T00:00:00Z', created_by: null,
  }
}

const ao = (id: string, docId: string, filename: string, page: number | null) =>
  engagementSourceDisplay({ sourceType: 'ao_clause', tenderDocumentId: docId, documentExists: true, documentFilename: filename, page })
const memo = () =>
  engagementSourceDisplay({ sourceType: 'memoire_engagement', tenderDocumentId: null, documentExists: false, documentFilename: null, page: null })
const unlocated = () =>
  engagementSourceDisplay({ sourceType: 'ao_clause', tenderDocumentId: null, documentExists: false, documentFilename: null, page: null })

// Scénario : CCTP (2 engagements), CCAP (1), mémoire (1), non localisé (1).
const scenario = {
  engagements: [
    engagement({ id: 'e1', short_label: 'CCTP un' }),
    engagement({ id: 'e2', short_label: 'CCTP deux' }),
    engagement({ id: 'e3', short_label: 'CCAP un' }),
    engagement({ id: 'e4', short_label: 'Mémoire un' }),
    engagement({ id: 'e5', short_label: 'Orphelin' }),
  ],
  sourceDisplays: {
    e1: ao('e1', 'doc-cctp', 'CCTP.pdf', 12),
    e2: ao('e2', 'doc-cctp', 'CCTP.pdf', null),
    e3: ao('e3', 'doc-ccap', 'CCAP.pdf', 3),
    e4: memo(),
    e5: unlocated(),
  },
}

const select = () => screen.getByLabelText('Filtrer par document') as HTMLSelectElement

describe('Curation — libellés de source', () => {
  it('affiche le libellé du presenter (📘 Exigence AO / ✍️ Proposé)', () => {
    render(<EngagementCurationView engagements={scenario.engagements} sourceDisplays={scenario.sourceDisplays} />)
    expect(screen.getByText('📘 Exigence AO — CCTP.pdf — page 12')).toBeInTheDocument()
    expect(screen.getByText('✍️ Proposé dans le mémoire technique')).toBeInTheDocument()
    expect(screen.getByText('⚠️ Source non localisée')).toBeInTheDocument()
  })
})

describe('Curation — filtre par document', () => {
  it('propose Tous + chaque source, avec compteurs ; non-localisé présent car > 0', () => {
    render(<EngagementCurationView engagements={scenario.engagements} sourceDisplays={scenario.sourceDisplays} />)
    const opts = within(select()).getAllByRole('option').map((o) => o.textContent)
    expect(opts).toContain('Tous les documents (5)')
    expect(opts).toContain('📘 CCTP.pdf — 2 engagements')
    expect(opts).toContain('📘 CCAP.pdf — 1 engagement')
    expect(opts).toContain('✍️ Mémoire technique — 1 engagement')
    expect(opts).toContain('⚠️ Source non localisée — 1 engagement')
  })

  it('filtre sur le CCTP → seuls ses 2 engagements (compteur à jour)', () => {
    render(<EngagementCurationView engagements={scenario.engagements} sourceDisplays={scenario.sourceDisplays} />)
    fireEvent.change(select(), { target: { value: 'doc-cctp' } })
    expect(screen.getByText('2 résultats')).toBeInTheDocument()
    expect(screen.getByText('CCTP un')).toBeInTheDocument()
    expect(screen.getByText('CCTP deux')).toBeInTheDocument()
    expect(screen.queryByText('CCAP un')).toBeNull()
    expect(screen.queryByText('Mémoire un')).toBeNull()
  })

  it('filtre sur le mémoire, puis sur le non-localisé', () => {
    render(<EngagementCurationView engagements={scenario.engagements} sourceDisplays={scenario.sourceDisplays} />)
    fireEvent.change(select(), { target: { value: 'memoire' } })
    expect(screen.getByText('Mémoire un')).toBeInTheDocument()
    expect(screen.queryByText('CCTP un')).toBeNull()
    fireEvent.change(select(), { target: { value: 'unlocated' } })
    expect(screen.getByText('Orphelin')).toBeInTheDocument()
    expect(screen.queryByText('Mémoire un')).toBeNull()
  })

  it('réinitialiser → tous les engagements reviennent', () => {
    render(<EngagementCurationView engagements={scenario.engagements} sourceDisplays={scenario.sourceDisplays} />)
    fireEvent.change(select(), { target: { value: 'doc-ccap' } })
    expect(screen.queryByText('CCTP un')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Réinitialiser/ }))
    expect(screen.getByText('CCTP un')).toBeInTheDocument()
    expect(screen.getByText('Orphelin')).toBeInTheDocument()
  })

  it('sans engagement non-localisé → PAS d\'entrée « Source non localisée »', () => {
    const eng = [engagement({ id: 'e1', short_label: 'A' })]
    const sd = { e1: ao('e1', 'doc-cctp', 'CCTP.pdf', 5) }
    render(<EngagementCurationView engagements={eng} sourceDisplays={sd} />)
    const opts = within(select()).getAllByRole('option').map((o) => o.textContent)
    expect(opts.some((o) => o?.includes('Source non localisée'))).toBe(false)
  })

  it('deux pièces de nom IDENTIQUE → valeurs de filtre distinctes (id, pas le nom)', () => {
    const eng = [engagement({ id: 'e1', short_label: 'Annexe A' }), engagement({ id: 'e2', short_label: 'Annexe B' })]
    const sd = { e1: ao('e1', 'id-A', 'Annexe.pdf', 1), e2: ao('e2', 'id-B', 'Annexe.pdf', 2) }
    render(<EngagementCurationView engagements={eng} sourceDisplays={sd} />)
    fireEvent.change(select(), { target: { value: 'id-A' } })
    expect(screen.getByText('Annexe A')).toBeInTheDocument()
    expect(screen.queryByText('Annexe B')).toBeNull()
  })
})
