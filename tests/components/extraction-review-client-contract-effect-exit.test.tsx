// DOC-CONTRACT-OS-1A-UX FIX (revue Vincent 2026-09-28, sous-défaut A) — la
// destination canonique en sortie de revue OS/Avenant doit être la fiche
// document (/documents/{id}), jamais un redirect vers les prestations du
// chantier. Le parcours CCTP historique (bulk "Créer les N Engagements" +
// redirect prestations) doit rester inchangé — ce n'est pas la même sortie
// pour un document qui MODIFIE le chantier (OS) que pour une simple vue du
// chantier (Prestations prévues).

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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
  finalizeAcceptedEngagementsAction: vi.fn(),
  acceptProposalAction: vi.fn(),
  editProposalAction: vi.fn(),
  rejectProposalAction: vi.fn(),
  resetProposalAction: vi.fn(),
  updatePersonAttendanceAction: vi.fn(),
  createEngagementFromProposalAction: vi.fn(),
  linkEngagementToProposalAction: vi.fn(),
}))

vi.mock('@/app/(dashboard)/documents/[id]/extraction/[runId]/SubjectSuggestionsSection', () => ({
  SubjectSuggestionsSection: () => null,
}))

function makeEngagementProposal(overrides: Partial<DbDocumentExtractionProposal> = {}): DbDocumentExtractionProposal {
  return {
    id: 'prop-1',
    organization_id: 'org-1',
    extraction_run_id: 'run-1',
    document_id: 'doc-1',
    target_site_id: 'site-1',
    proposal_family: 'engagement',
    stable_key: null,
    label: 'Nettoyage mensuel des VMC',
    description: null,
    source_page: 4,
    source_excerpt: 'Le titulaire procède au nettoyage mensuel des groupes VMC.',
    source_payload: { contract_effect: { effect: 'new' } },
    thematic_category: null,
    document_status: null,
    subject_thread_id: null,
    review_status: 'accepted',
    reviewed_label: null,
    reviewed_description: null,
    reviewed_family: null,
    reviewed_at: null,
    reviewed_by: null,
    created_at: '2026-09-01T00:00:00.000Z',
    ...overrides,
  } as DbDocumentExtractionProposal
}

function withEvidence(proposal: DbDocumentExtractionProposal): DocumentExtractionProposalWithEvidence {
  return { proposal, evidence: [], materializations: [] }
}

function renderClient(opts: {
  documentType: string
  proposals: DocumentExtractionProposalWithEvidence[]
}) {
  const summary = computeReviewSummary(opts.proposals.map((p) => p.proposal))
  return render(
    <ExtractionReviewClient
      proposals={opts.proposals}
      orphanEvidence={[]}
      signedUrls={{}}
      documentId="doc-1"
      runId="run-1"
      summary={summary}
      effectiveDate="2026-09-01"
      targetSiteId="site-1"
      alreadySiteReportId={null}
      candidateLinks={[]}
      initialIllustratesLinks={[]}
      isEngagementRun
      documentType={opts.documentType}
    />,
  )
}

describe('ExtractionReviewClient — sortie de revue OS/Avenant vs CCTP (DOC-CONTRACT-OS-1A-UX FIX)', () => {
  it('OS qualifié (effet NEW) → "Terminer la revue" pointe vers /documents/{id}, jamais les prestations', () => {
    renderClient({
      documentType: 'ordre_service',
      proposals: [withEvidence(makeEngagementProposal({ review_status: 'edited' }))],
    })
    const link = screen.getByRole('link', { name: 'Terminer la revue' })
    expect(link.getAttribute('href')).toBe('/documents/doc-1')
    expect(screen.queryByText(/Voir les prestations prévues/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Créer les? \d+ Engagement/ })).not.toBeInTheDocument()
  })

  it('CCTP historique (documentType non qualifiant) → ancien parcours bulk inchangé, aucun "Terminer la revue"', () => {
    renderClient({
      documentType: 'cctp',
      proposals: [withEvidence(makeEngagementProposal({ review_status: 'edited', source_payload: null }))],
    })
    expect(screen.getByRole('button', { name: 'Créer les 1 Engagement' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Terminer la revue' })).not.toBeInTheDocument()
  })
})
