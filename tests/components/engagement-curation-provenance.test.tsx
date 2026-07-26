// Curation — la source affichée vient de la provenance structurée (read model),
// jamais de la page devinée de source_ref. Display-only : aucun changement de
// regroupement, d'édition ou de statut.

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EngagementCurationView } from '@/app/(dashboard)/tenders/[id]/engagement-curation-view'
import type { DbEngagement } from '@/types/db'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

function engagement(p: Partial<DbEngagement>): DbEngagement {
  return {
    id: p.id ?? 'e-1',
    tender_id: 't-1',
    contract_id: null,
    source_type: 'ao_clause',
    source_excerpt: p.source_excerpt ?? 'nettoyage quotidien des locaux',
    // source_ref hérité présent : il ne doit JAMAIS servir à afficher la source.
    source_ref: p.source_ref ?? { page: 99, section: 'IV.2' },
    tender_document_id: p.tender_document_id ?? null,
    page_number: p.page_number ?? null,
    category: 'compliance',
    kind: p.kind ?? 'obligation',
    short_label: p.short_label ?? 'Nettoyage quotidien',
    measurable: true,
    ai_confidence: 0.9,
    status: p.status ?? 'extracted',
    proof_requirement: 'none',
    destination: 'contract_engagement',
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    created_by: null,
  }
}

describe('EngagementCurationView — source structurée', () => {
  it('affiche le libellé de provenance fourni (exact)', () => {
    render(
      <EngagementCurationView
        engagements={[engagement({ id: 'e-1', short_label: 'Pénalité de retard' })]}
        provenanceLabels={{ 'e-1': 'CCTP.pdf — page 12' }}
      />,
    )
    expect(screen.getByText('Source : CCTP.pdf — page 12')).toBeInTheDocument()
  })

  it('affiche « page non localisée » pour document_only', () => {
    render(
      <EngagementCurationView
        engagements={[engagement({ id: 'e-1' })]}
        provenanceLabels={{ 'e-1': 'CCTP.pdf — page non localisée' }}
      />,
    )
    expect(screen.getByText('Source : CCTP.pdf — page non localisée')).toBeInTheDocument()
  })

  it('ne réintroduit JAMAIS la page devinée de source_ref (p. 99 / § IV.2)', () => {
    render(
      <EngagementCurationView
        engagements={[engagement({ id: 'e-1' })]}
        provenanceLabels={{ 'e-1': 'Source non localisée' }}
      />,
    )
    // La source structurée est là…
    expect(screen.getByText('Source : Source non localisée')).toBeInTheDocument()
    // …et jamais la référence héritée de source_ref.
    expect(screen.queryByText(/p\. 99/)).toBeNull()
    expect(screen.queryByText(/§ IV\.2/)).toBeNull()
  })

  it('sans libellé de provenance → aucune ligne de source (pas de repli source_ref)', () => {
    render(<EngagementCurationView engagements={[engagement({ id: 'e-1' })]} />)
    expect(screen.queryByText(/^Source :/)).toBeNull()
    expect(screen.queryByText(/p\. 99/)).toBeNull()
  })
})
