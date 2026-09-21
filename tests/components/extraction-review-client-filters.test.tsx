// GO Vincent 2026-09-22 — filtres type/confiance de la page de revue d'extraction
// historique doivent être des filtres EXCLUSIFS de contenu (pas un dépliage/repliage).
//
// Couvre le comportement cible demandé par Vincent :
//   1. clic sur Faible → n'affiche que les propositions de confiance faible
//   2. clic sur Action → n'affiche que les Actions
//   3. Toutes → réaffiche l'ensemble
//   4. combinaison avec le filtre statut (Action + À examiner)
//   5. absence de propositions hors filtre (Décision → rien d'autre)

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ExtractionReviewClient } from '@/app/(dashboard)/documents/[id]/extraction/[runId]/ExtractionReviewClient'
import { computeReviewSummary } from '@/lib/documents/effective-proposal'
import type { DbDocumentExtractionProposal, DocumentExtractionProposalWithEvidence } from '@/types/db'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/documents/doc-1/extraction/run-1',
}))

vi.mock('@/app/(dashboard)/documents/[id]/extraction/[runId]/review-actions', () => ({
  createHistoricalVisitAction: vi.fn(),
  acceptAllPendingAction: vi.fn(),
  toggleEvidencePinAction: vi.fn(),
  pinAllSnapshotsAction: vi.fn(),
  confirmPhotoAssociationAction: vi.fn(),
  dismissPhotoAssociationAction: vi.fn(),
  revertIllustratesAction: vi.fn(),
}))

vi.mock('@/app/(dashboard)/documents/[id]/extraction/[runId]/SubjectSuggestionsSection', () => ({
  SubjectSuggestionsSection: () => null,
}))

vi.mock('@/app/(dashboard)/documents/[id]/extraction/[runId]/ProposalCard', () => ({
  ProposalCard: ({ proposal }: { proposal: DbDocumentExtractionProposal }) => (
    <div data-testid={`proposal-${proposal.id}`}>
      {proposal.label} · {proposal.proposal_family} · {proposal.review_status}
    </div>
  ),
}))

function makeProposal(overrides: {
  id: string
  proposal_family: DbDocumentExtractionProposal['proposal_family']
  label: string
  review_status?: DbDocumentExtractionProposal['review_status']
  relevanceScore?: 'strong' | 'medium' | 'weak'
}): DocumentExtractionProposalWithEvidence {
  return {
    proposal: {
      id: overrides.id,
      organization_id: 'org-1',
      extraction_run_id: 'run-1',
      document_id: 'doc-1',
      target_site_id: null,
      proposal_family: overrides.proposal_family,
      stable_key: null,
      label: overrides.label,
      description: null,
      source_page: null,
      source_excerpt: null,
      source_payload: overrides.relevanceScore ? { relevanceScore: overrides.relevanceScore } : null,
      thematic_category: null,
      document_status: null,
      subject_thread_id: null,
      review_status: overrides.review_status ?? 'pending',
      reviewed_label: null,
      reviewed_description: null,
      reviewed_family: null,
      reviewed_at: null,
      reviewed_by: null,
      created_at: '2026-09-01T00:00:00.000Z',
    },
    evidence: [],
    materializations: [],
  }
}

// 1 proposition Entreprise faible (l'exemple exact de Vincent) + 14 Actions (5 pending / 9
// acceptées, pour la combinaison avec le filtre statut) + 1 Décision, pour vérifier
// l'isolement d'un filtre à un seul élément.
const WEAK_COMPANY = makeProposal({
  id: 'p-parasitech', proposal_family: 'company', label: 'Parasitech', relevanceScore: 'weak',
})
const ACTIONS = Array.from({ length: 14 }, (_, i) =>
  makeProposal({
    id: `p-action-${i}`,
    proposal_family: 'action',
    label: `Action ${i}`,
    review_status: i < 5 ? 'pending' : 'accepted',
  }),
)
const DECISION = makeProposal({ id: 'p-decision-1', proposal_family: 'decision', label: 'Décision unique', review_status: 'accepted' })

const PROPOSALS = [WEAK_COMPANY, ...ACTIONS, DECISION]

function renderClient() {
  const summary = computeReviewSummary(PROPOSALS.map((p) => p.proposal))
  return render(
    <ExtractionReviewClient
      proposals={PROPOSALS}
      orphanEvidence={[]}
      signedUrls={{}}
      documentId="doc-1"
      runId="run-1"
      summary={summary}
      effectiveDate={null}
      targetSiteId={null}
      alreadySiteReportId={null}
      candidateLinks={[]}
      initialIllustratesLinks={[]}
    />,
  )
}

describe('ExtractionReviewClient — filtre Faible', () => {
  it('clic sur Faible → seule la proposition de confiance faible (Parasitech) est affichée', () => {
    renderClient()
    fireEvent.click(screen.getByTestId('family-filter-weak'))

    expect(screen.getAllByTestId(/^proposal-/)).toHaveLength(1)
    expect(screen.getByTestId('proposal-p-parasitech')).toBeInTheDocument()
    expect(screen.queryByTestId('proposal-p-action-0')).not.toBeInTheDocument()
    expect(screen.queryByTestId('proposal-p-decision-1')).not.toBeInTheDocument()
    // Un seul filtre de ce niveau actif à la fois, état visuel explicite.
    expect(screen.getByTestId('family-filter-weak')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('family-filter-all')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('family-filter-action')).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('ExtractionReviewClient — filtre Action', () => {
  it('clic sur Action → les 14 Actions sont affichées, rien d\'autre', () => {
    renderClient()
    fireEvent.click(screen.getByTestId('family-filter-action'))

    const rendered = screen.getAllByTestId(/^proposal-/)
    expect(rendered).toHaveLength(14)
    for (let i = 0; i < 14; i++) {
      expect(screen.getByTestId(`proposal-p-action-${i}`)).toBeInTheDocument()
    }
    expect(screen.queryByTestId('proposal-p-parasitech')).not.toBeInTheDocument()
    expect(screen.queryByTestId('proposal-p-decision-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('family-filter-action')).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('ExtractionReviewClient — retour Toutes', () => {
  it('après un filtre Action, clic sur Toutes → l\'ensemble des 16 propositions revient', () => {
    renderClient()
    fireEvent.click(screen.getByTestId('family-filter-action'))
    expect(screen.getAllByTestId(/^proposal-/)).toHaveLength(14)

    fireEvent.click(screen.getByTestId('family-filter-all'))
    expect(screen.getAllByTestId(/^proposal-/)).toHaveLength(PROPOSALS.length)
    expect(screen.getByTestId('proposal-p-parasitech')).toBeInTheDocument()
    expect(screen.getByTestId('proposal-p-decision-1')).toBeInTheDocument()
    expect(screen.getByTestId('family-filter-all')).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('ExtractionReviewClient — combinaison filtre type + filtre statut', () => {
  it('Action + À examiner → seules les 5 Actions encore pending sont affichées', () => {
    renderClient()
    fireEvent.click(screen.getByTestId('family-filter-action'))
    fireEvent.click(screen.getByTestId('status-filter-pending'))

    const rendered = screen.getAllByTestId(/^proposal-/)
    expect(rendered).toHaveLength(5)
    for (let i = 0; i < 5; i++) {
      expect(screen.getByTestId(`proposal-p-action-${i}`)).toBeInTheDocument()
    }
    for (let i = 5; i < 14; i++) {
      expect(screen.queryByTestId(`proposal-p-action-${i}`)).not.toBeInTheDocument()
    }
    // Les deux axes restent actifs et visuellement distincts simultanément.
    expect(screen.getByTestId('family-filter-action')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('status-filter-pending')).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('ExtractionReviewClient — absence de propositions hors filtre', () => {
  it('clic sur Décision → uniquement la décision, aucune Action ni Entreprise', () => {
    renderClient()
    fireEvent.click(screen.getByTestId('family-filter-decision'))

    expect(screen.getAllByTestId(/^proposal-/)).toHaveLength(1)
    expect(screen.getByTestId('proposal-p-decision-1')).toBeInTheDocument()
    expect(screen.queryByTestId('proposal-p-parasitech')).not.toBeInTheDocument()
    expect(screen.queryByTestId('proposal-p-action-0')).not.toBeInTheDocument()
    expect(screen.queryByText(/Action \d+/)).not.toBeInTheDocument()
  })
})
